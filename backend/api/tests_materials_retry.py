"""Tests for the material retry endpoint (`POST /api/materials/<pk>/retry`).

The fallback this guards: an uploaded reference document whose ingest failed (or whose
drain never ran) had no recovery path in the product at all — the file is still on disk,
so re-uploading it was the only option.

DB-free like the rest of the suite: `connection`, `_get_document` and
`is_lecturer_for_subject` are patched, so nothing touches the shared dev DB and no
ingest runs inside the request. Run with:

    venv/Scripts/python.exe manage.py test api.tests_materials_retry -v 2
"""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api import materials_views as mv

DOC_ID = '11111111-2222-3333-4444-555555555555'
SUBJECT_ID = '99999999-8888-7777-6666-555555555555'
USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'


def _row(status='FAILED', file_path='materials/stored.pdf', error='RuntimeError: boom',
         chunk_count=None):
    """A row in `_DOCUMENT_COLUMNS` order: id, subject, topic, title, mime, status,
    error, chunk_count, created_at, file_path."""
    return (
        uuid.UUID(DOC_ID), uuid.UUID(SUBJECT_ID), None, 'Dokumen Uji',
        'application/pdf', status, error, chunk_count, '2026-10-19T00:00:00Z', file_path,
    )


class IngestWorkerStateTests(SimpleTestCase):
    """The UI needs to tell "the worker will get to it" from "nothing is draining"."""

    def _state(self, rows):
        with patch.object(mv, 'worker_status', return_value=rows):
            return mv._ingest_worker_state()

    def test_no_heartbeat_row_means_no_drainer(self):
        self.assertEqual(self._state([]), 'missing')

    def test_fresh_heartbeat_is_alive(self):
        self.assertEqual(self._state([{'age_seconds': 4.0}]), 'alive')

    def test_stale_heartbeat_is_not_alive(self):
        self.assertEqual(self._state([{'age_seconds': 600.0}]), 'stale')

    def test_unparseable_age_is_treated_as_stale(self):
        # worker_status() never raises, so a missing/odd field is the only signal left.
        self.assertEqual(self._state([{'age_seconds': None}]), 'stale')


class MaterialRetryTests(SimpleTestCase):
    def setUp(self):
        self.request = SimpleNamespace(user=SimpleNamespace(id=uuid.UUID(USER_ID)))
        self.view = mv.MaterialRetryView()

    def _post(self, pre_row, post_row=None):
        """Run the view with `_get_document` returning `pre_row` then `post_row`."""
        returns = [pre_row] if post_row is None else [pre_row, post_row]
        with patch.object(mv, '_get_document', side_effect=returns), \
                patch.object(mv, 'connection') as conn:
            self.cursor = conn.cursor.return_value.__enter__.return_value
            response = self.view.post(self.request, pk=uuid.UUID(DOC_ID))
        return response

    def test_unknown_document_is_404(self):
        response = self._post(None)
        self.assertEqual(response.status_code, 404)

    def test_other_lecturers_document_is_403(self):
        with patch.object(mv, 'is_lecturer_for_subject', return_value=False):
            response = self._post(_row())
        self.assertEqual(response.status_code, 403)

    def test_ready_document_is_conflict_and_untouched(self):
        # Re-ingesting a READY document would append a second copy of every chunk.
        with patch.object(mv, 'is_lecturer_for_subject', return_value=True):
            response = self._post(_row(status='READY', chunk_count=12))
        self.assertEqual(response.status_code, 409)
        self.cursor.execute.assert_not_called()

    def test_document_without_a_stored_file_is_conflict(self):
        # The drain selects `file_path IS NOT NULL`, so re-queueing it would hang in
        # PENDING forever — say so instead of pretending the retry worked.
        with patch.object(mv, 'is_lecturer_for_subject', return_value=True):
            response = self._post(_row(file_path=None))
        self.assertEqual(response.status_code, 409)
        self.assertIn('Unggah ulang', response.data['detail'])
        self.cursor.execute.assert_not_called()

    def test_failed_document_is_requeued_with_a_clean_slate(self):
        with patch.object(mv, 'is_lecturer_for_subject', return_value=True), \
                patch.object(mv, '_ingest_worker_state', return_value='alive'):
            response = self._post(
                _row(status='FAILED', chunk_count=None),
                _row(status='PENDING', error=None),
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data['ingest_status'], 'PENDING')
        self.assertIsNone(response.data['ingest_error'])
        self.assertEqual(response.data['ingest_worker'], 'alive')

        statements = [call.args[0] for call in self.cursor.execute.call_args_list]
        # Partial chunk rows from the failed run must go, or the re-run appends.
        self.assertIn('DELETE FROM knowledge_chunks', statements[0])
        self.assertIn("SET ingest_status = 'PENDING'", statements[1])
        self.assertIn('ingest_error = NULL', statements[1])
        self.assertEqual(
            [call.args[1] for call in self.cursor.execute.call_args_list],
            [[DOC_ID], [DOC_ID]],
        )

    def test_pending_document_can_also_be_requeued(self):
        # The queue can stall with the drain missing entirely; the lecturer needs a
        # way to nudge it without knowing that.
        with patch.object(mv, 'is_lecturer_for_subject', return_value=True), \
                patch.object(mv, '_ingest_worker_state', return_value='missing'):
            response = self._post(
                _row(status='PENDING', error=None),
                _row(status='PENDING', error=None),
            )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data['ingest_worker'], 'missing')

    def test_ingest_is_not_run_inside_the_request(self):
        # A 50 MB PDF would blow the request timeout; the supervised loop owns that.
        from api.management.commands import ingest_materials as ingest_cmd

        with patch.object(mv, 'is_lecturer_for_subject', return_value=True), \
                patch.object(mv, '_ingest_worker_state', return_value='alive'), \
                patch.object(ingest_cmd.Command, '_drain') as drain:
            self._post(_row(), _row(status='PENDING'))
        drain.assert_not_called()
