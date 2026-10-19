"""Tests for the re-analysis action (`POST /api/submissions/<pk>/reanalyze`).

The gap it closes: `ANALYSIS_FAILED` is terminal for the worker — `_claim_next()` only
claims rows with `analysis_attempts < LLM_MAX_RUNS` — so the review page's
"dijadwalkan ulang oleh sistem" was untrue and a lecturer had no way to retry. The same
failed run also leaves its reading material `FAILED`, and that drain only selects
`PENDING`/`STALE`, so the action re-queues those rows too.

DB-free like the rest of the suite: `connection`, `is_lecturer_for_subject` and
`worker_status` are patched, so nothing touches the shared dev DB and no analysis runs
inside the request. Run with:

    venv/Scripts/python.exe manage.py test api.tests_submission_reanalyze -v 2
"""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api import validation_views as vv

SUBMISSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444'
SUBJECT_ID = '99999999-8888-7777-6666-555555555555'
VERSION_ID = 'cccccccc-1111-2222-3333-444444444444'
USER_ID = 'bbbbbbbb-1111-2222-3333-444444444444'

_ALLOWED = patch.object(vv, 'is_lecturer_for_subject', return_value=True)


class AnalysisWorkerStateTests(SimpleTestCase):
    def _state(self, rows):
        with patch.object(vv, 'worker_status', return_value=rows):
            return vv._analysis_worker_state()

    def test_no_heartbeat_row_means_no_worker(self):
        self.assertEqual(self._state([]), 'missing')

    def test_fresh_heartbeat_is_alive(self):
        self.assertEqual(self._state([{'age_seconds': 2.0}]), 'alive')

    def test_stale_heartbeat_is_not_alive(self):
        self.assertEqual(self._state([{'age_seconds': 900.0}]), 'stale')


class SubmissionReanalyzeTests(SimpleTestCase):
    def setUp(self):
        self.request = SimpleNamespace(user=SimpleNamespace(id=uuid.UUID(USER_ID)))
        self.view = vv.SubmissionReanalyzeView()

    def _row(self, status='ANALYSIS_FAILED', attempts=3):
        return (uuid.UUID(SUBJECT_ID), uuid.UUID(VERSION_ID), status, attempts)

    def _post(self, row, materials_requeued=2, data=None):
        if data is not None:
            self.request.data = data
        with patch.object(vv, 'connection') as conn, \
                patch.object(vv, 'transaction') as txn, \
                patch.object(vv, '_analysis_worker_state', return_value='alive'):
            cur = conn.cursor.return_value.__enter__.return_value
            cur.fetchone.return_value = row
            cur.rowcount = materials_requeued
            response = self.view.post(self.request, pk=uuid.UUID(SUBMISSION_ID))
            self.cursor = cur
            self.txn = txn
        return response

    def test_unknown_submission_is_404(self):
        with _ALLOWED:
            response = self._post(None)
        self.assertEqual(response.status_code, 404)

    def test_other_lecturers_submission_is_403(self):
        with patch.object(vv, 'is_lecturer_for_subject', return_value=False):
            response = self._post(self._row())
        self.assertEqual(response.status_code, 403)

    def test_analysis_awaiting_review_can_be_rejected_into_a_reanalysis(self):
        # "Tolak & analisis ulang": the analysis exists, the lecturer criticises it. This
        # must not go through the validation endpoint — that wrote a validations row (so
        # the item looked validated) and left ANALYSIS_FAILED unvalidatable afterwards.
        with _ALLOWED:
            response = self._post(self._row(status='PENDING_VALIDATION', attempts=1))
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data['previous_status'], 'PENDING_VALIDATION')

    def test_a_submission_already_in_the_queue_is_conflict(self):
        for status in ('SUBMITTED', 'ANALYZING'):
            with _ALLOWED:
                response = self._post(self._row(status=status, attempts=0))
            self.assertEqual(response.status_code, 409, status)
            # Only the ownership SELECT ran: nothing re-armed behind the worker's back.
            self.assertEqual(len(self.cursor.execute.call_args_list), 1)

    def test_failed_submission_is_rearmed_and_materials_requeued(self):
        with _ALLOWED:
            response = self._post(self._row(status='ANALYSIS_FAILED', attempts=3), materials_requeued=2)

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data['status'], 'SUBMITTED')
        self.assertEqual(response.data['analysis_attempts'], 0)
        self.assertEqual(response.data['previous_attempts'], 3)
        self.assertEqual(response.data['reading_materials_requeued'], 2)
        self.assertEqual(response.data['analysis_worker'], 'alive')

        statements = [call.args[0] for call in self.cursor.execute.call_args_list]
        # The SELECT, then the two writes.
        self.assertIn('FROM submissions WHERE id = %s', statements[0])
        self.assertIn("SET status = 'SUBMITTED', analysis_attempts = 0", statements[1])
        # Without this the analysis succeeds and the lecturer still sees no material.
        self.assertIn("SET status = 'PENDING', error = NULL", statements[2])
        # `attempts` must be reset too: the drain re-caps rows at READING_MATERIAL_MAX_RUNS
        # *without* an error message, so a capped row would silently stay FAILED.
        self.assertIn('attempts = 0', statements[2])
        self.assertIn("status = 'FAILED'", statements[2])
        self.assertEqual(
            self.cursor.execute.call_args_list[2].args[1], [VERSION_ID]
        )

    def test_the_attempt_counter_is_reset_not_merely_retried(self):
        # A parked row has attempts == LLM_MAX_RUNS, so leaving the counter alone would
        # re-arm it into immediate re-parking.
        with _ALLOWED:
            self._post(self._row(status='ANALYSIS_FAILED', attempts=3))
        update_params = self.cursor.execute.call_args_list[1].args[1]
        self.assertEqual(update_params, [SUBMISSION_ID])
        self.assertIn('analysis_attempts = 0', self.cursor.execute.call_args_list[1].args[0])

    def test_a_notes_payload_lands_on_the_analysis_being_criticised(self):
        # The rejection reason is prompt guidance ("[CATATAN DOSEN PADA ANALISIS
        # SEBELUMNYA]"), stored on the analysis — never as a `validations` row, which is
        # what made a rejected item look validated.
        with _ALLOWED:
            response = self._post(
                self._row(status='PENDING_VALIDATION', attempts=1),
                data={'notes': '  Tier 3 salah: gaya gesek dianggap gaya aktif  '},
            )

        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.data['note_saved'])
        statements = [call.args[0] for call in self.cursor.execute.call_args_list]
        self.assertIn('UPDATE llm_analyses', statements[1])
        self.assertIn('lecturer_note', statements[1])
        self.assertEqual(
            self.cursor.execute.call_args_list[1].args[1],
            ['Tier 3 salah: gaya gesek dianggap gaya aktif', SUBMISSION_ID],
        )
        self.assertFalse(any('validations' in s for s in statements),
                         're-analysis must not write a validation record')
        self.assertIn("SET status = 'SUBMITTED', analysis_attempts = 0", statements[2])

    def test_no_notes_means_no_analysis_write(self):
        with _ALLOWED:
            response = self._post(self._row(status='ANALYSIS_FAILED', attempts=3), data={})
        self.assertFalse(response.data['note_saved'])
        self.assertNotIn('UPDATE llm_analyses',
                         [call.args[0] for call in self.cursor.execute.call_args_list])
