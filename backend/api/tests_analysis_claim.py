"""The analysis claim query — who gets picked up, and what stops a row looping.

Two rules matter operationally and have both been wrong before:

1. `ANALYSIS_FAILED` rows must stay bounded by `analysis_attempts` (migration 0028), or a
   row that keeps failing is re-claimed forever and blocks the queue.
2. `REJECTED` rows (a lecturer pressing "Tolak & analisis ulang") must be claimable
   *unconditionally*. The old cap `count(llm_analyses) < max_runs` silently ignored the
   lecturer for any submission already analysed three times — every analysis writes a row
   and a reject never clears them — which looks like "the button does nothing".

DB-free: `connection` is patched and yields no row, so only the SQL is inspected.
"""

from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase

from api.management.commands import analyze_submissions as mod


class ClaimQueryTests(SimpleTestCase):
    def _sql_and_params(self):
        with patch.object(mod, 'connection') as conn:
            cur = conn.cursor.return_value.__enter__.return_value
            cur.fetchone.return_value = None
            result = mod.Command()._claim_next()
            self.assertIsNone(result)
            sql = cur.execute.call_args.args[0]
            # The comments explain the history (and mention the old cap); assert on the
            # executable SQL so prose cannot make a test pass or fail.
            code = '\n'.join(line.split('--')[0] for line in sql.splitlines())
            return code, cur.execute.call_args.args[1]

    def test_rejected_rows_are_not_capped_by_the_analysis_count(self):
        sql, _ = self._sql_and_params()
        self.assertNotIn('llm_analyses', sql)
        self.assertIn("s.status = 'REJECTED'", sql)

    def test_failed_rows_are_still_bounded_by_attempts(self):
        sql, params = self._sql_and_params()
        self.assertIn("s.status IN ('SUBMITTED', 'ANALYSIS_FAILED')", sql)
        self.assertIn('s.analysis_attempts < %s', sql)
        self.assertEqual(params, [getattr(settings, 'LLM_MAX_RUNS', 3)])

    def test_claim_takes_a_row_lock_and_skips_locked_ones(self):
        # Without SKIP LOCKED the two supervised passes would serialise behind each other.
        sql, _ = self._sql_and_params()
        self.assertIn('FOR UPDATE SKIP LOCKED', sql)

    def test_returns_the_claimed_id_as_a_string(self):
        with patch.object(mod, 'connection') as conn:
            import uuid

            claimed = uuid.uuid4()
            cur = conn.cursor.return_value.__enter__.return_value
            cur.fetchone.return_value = (claimed,)
            result = mod.Command()._claim_next()
        self.assertEqual(result, str(claimed))
