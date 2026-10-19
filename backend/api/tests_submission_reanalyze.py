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

    def _post(self, row, materials_requeued=2):
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

    def test_analysed_submission_is_conflict_and_untouched(self):
        # A row with an analysis to review belongs to "Tolak", not here: re-arming it
        # would throw away an analysis the lecturer can still validate.
        with _ALLOWED:
            response = self._post(self._row(status='PENDING_VALIDATION', attempts=1))
        self.assertEqual(response.status_code, 409)
        # Only the ownership SELECT ran: no UPDATE, nothing re-armed.
        self.assertEqual(len(self.cursor.execute.call_args_list), 1)
        self.assertIn('SELECT subject_id', self.cursor.execute.call_args_list[0].args[0])

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
