"""Tests for the reference-material ingest drain's loop contract.

Deliberately DB-free (`SimpleTestCase`), for the same reason as
`tests_worker_supervisor`: almost every table here is unmanaged and the schema is
owned by `V2_Full_Script.sql`, so the suite never opens a connection. Every
side effect `_drain` has — the heartbeat, the queue query, the embeddings call, the
file system and even `time.sleep` — is patched, so these tests also double as the
check that the drain has no hidden I/O on its loop path.

Why this module exists: nothing drained the upload queue until the supervisor grew
an `ingest` worker, and a document that raised was marked FAILED while
`_select_pending()` only ever picked PENDING rows — permanently unrecoverable. The
first case is the loop contract; the last is `--retry-failed`.

`_drain` is called directly with an options dict (not through `call_command`): the
drain is a private method whose whole contract is the dict keys, and `call_command`
would add argparse, `logging.basicConfig` and settings noise without testing more.
"""

from io import StringIO
from unittest import mock
from unittest.mock import MagicMock, patch

from django.core.management.base import CommandError
from django.test import SimpleTestCase

from api.management.commands import ingest_materials as ingest_cmd


# Straight from `_select_pending`'s result shape: (id, subject_id, topic_id, title,
# file_path, mime_type).
BROKEN = ('doc-1', 'subj-1', None, 'Broken', 'materials/broken.pdf', 'application/pdf')
GOOD = ('doc-2', 'subj-1', None, 'Good', 'materials/good.md', 'text/markdown')


def _parser():
    return ingest_cmd.Command().create_parser('manage.py', 'ingest_materials')


class IngestDrainLoopTests(SimpleTestCase):
    def setUp(self):
        # The heartbeat and the sleep are the two I/O calls on the loop path; patch
        # them here so no test can accidentally sleep (loop mode would never return)
        # or open a connection.
        heartbeat = patch.object(ingest_cmd, 'record_heartbeat')
        self.record_heartbeat = heartbeat.start()
        self.addCleanup(heartbeat.stop)
        sleep = patch.object(ingest_cmd.time, 'sleep')
        self.sleep = sleep.start()
        self.addCleanup(sleep.stop)

    def _options(self, **overrides):
        options = {'loop': False, 'interval': 10, 'batch_size': 64}
        options.update(overrides)
        return options

    def _drain(self, options, pending=(), supervisor_gone=None):
        """Run one command invocation and return (stdout, stderr)."""
        out, err = StringIO(), StringIO()
        self.command = ingest_cmd.Command(stdout=out, stderr=err)
        with patch.object(ingest_cmd, '_select_pending', return_value=list(pending)):
            if supervisor_gone is None:
                self.command._drain(options)
            else:
                with patch.object(ingest_cmd, 'supervisor_gone',
                                  side_effect=supervisor_gone):
                    self.command._drain(options)
        return out.getvalue(), err.getvalue()

    # -- heartbeat ------------------------------------------------------------

    def test_one_shot_records_a_heartbeat_on_its_tick(self):
        # Liveness is written before the queue is read: a drain that hangs on the
        # query would otherwise be indistinguishable from an empty queue.
        out, _ = self._drain(self._options())
        self.record_heartbeat.assert_called_once_with('ingest', {'mode': 'once'})

    def test_loop_records_a_heartbeat_on_every_tick(self):
        # Two ticks then the supervisor is gone. If the heartbeat were written once
        # before the loop (or after the sleep), the second tick would be invisible.
        self._drain(self._options(loop=True, interval=1), supervisor_gone=[False, True])
        self.assertEqual(
            [c.args for c in self.record_heartbeat.call_args_list],
            [('ingest', {'mode': 'loop'}), ('ingest', {'mode': 'loop'})],
        )

    # -- supervisor watchdog --------------------------------------------------

    def test_loop_mode_exits_when_the_supervisor_is_gone(self):
        out, err = self._drain(self._options(loop=True), supervisor_gone=[True])
        self.assertIn('supervisor gone', err)
        self.record_heartbeat.assert_called_once()  # the tick before the check

    def test_single_shot_never_consults_the_supervisor(self):
        # A human running --pending in a terminal must not be killed by a watchdog
        # that only makes sense for a spawned worker.
        with patch.object(ingest_cmd, 'supervisor_gone') as gone:
            self._drain(self._options())
        gone.assert_not_called()

    # -- queue handling -------------------------------------------------------

    def test_empty_queue_prints_and_returns_without_sleeping(self):
        out, _ = self._drain(self._options())
        self.assertIn('Nothing pending.', out)
        self.sleep.assert_not_called()

    def test_loop_sleeps_for_the_interval_instead_of_busy_spinning(self):
        self._drain(self._options(loop=True, interval=3), supervisor_gone=[False, True])
        self.assertEqual(self.sleep.call_args_list, [mock.call(3)])

    def test_failure_isolation_marks_failed_and_continues_in_the_same_tick(self):
        calls = []

        def fake_ingest(command_self, document_id, subject_id, topic_id, file_path,
                        batch_size):
            calls.append(document_id)
            if document_id == 'doc-1':
                raise RuntimeError('corrupt pdf')
            return 3

        with patch.object(ingest_cmd.Command, '_ingest_pending_document', fake_ingest), \
                patch.object(ingest_cmd, '_mark_failed') as mark_failed:
            out, err = self._drain(self._options(), pending=[BROKEN, GOOD])

        # Both documents were attempted in the one tick, oldest first.
        self.assertEqual(calls, ['doc-1', 'doc-2'])
        self.assertIn('doc-2 "Good" -> READY (3 chunks)', out)
        # The failed one carries its error text so the operator can see why.
        mark_failed.assert_called_once_with('doc-1', 'RuntimeError: corrupt pdf')
        self.assertIn('FAILED', err)


class SelectPendingSqlTests(SimpleTestCase):
    """The FAILED gap: the SQL is the whole fix, so assert on the SQL string.

    Mocked cursor only — `SimpleTestCase` forbids the DB and the test suite is
    contractually connection-free.
    """

    def _sql_for(self, **kwargs):
        fake_connection = MagicMock()
        cursor = fake_connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [BROKEN]
        with patch.object(ingest_cmd, 'connection', fake_connection):
            rows = ingest_cmd._select_pending(**kwargs)
        return cursor.execute.call_args[0][0], rows

    def test_default_predicate_never_mentions_failed(self):
        # The default must stay byte-for-byte the behaviour existing callers had:
        # no flag, no FAILED rows.
        sql, rows = self._sql_for()
        self.assertNotIn('FAILED', sql)
        self.assertIn("ingest_status = 'PENDING'", sql)
        self.assertIn('file_path IS NOT NULL', sql)
        self.assertIn('ORDER BY created_at', sql)
        self.assertEqual(rows, [BROKEN])

    def test_include_failed_selects_failed_rows_too(self):
        sql, _ = self._sql_for(include_failed=True)
        self.assertIn("ingest_status IN ('PENDING', 'FAILED')", sql)
        self.assertIn('file_path IS NOT NULL', sql)
        self.assertIn('ORDER BY created_at', sql)

    def test_both_modes_return_the_same_row_shape(self):
        default_sql, _ = self._sql_for()
        retry_sql, _ = self._sql_for(include_failed=True)
        columns = 'id, subject_id, topic_id, title, file_path, mime_type'
        self.assertIn(columns, default_sql)
        self.assertIn(columns, retry_sql)


class RetryFailedFlagTests(SimpleTestCase):
    """`--retry-failed` is what makes a FAILED upload recoverable in place."""

    def test_drain_does_not_include_failed_rows_by_default(self):
        with patch.object(ingest_cmd, '_select_pending', return_value=[]) as select:
            ingest_cmd.Command()._drain({'loop': False, 'interval': 10,
                                         'batch_size': 64})
        select.assert_called_once_with(False)

    def test_drain_passes_the_flag_through_to_the_selection(self):
        with patch.object(ingest_cmd, '_select_pending', return_value=[]) as select:
            ingest_cmd.Command()._drain({'loop': False, 'interval': 10,
                                         'batch_size': 64, 'retry_failed': True})
        select.assert_called_once_with(True)

    def test_parser_accepts_retry_failed_alongside_pending(self):
        options = _parser().parse_args(['--pending', '--retry-failed'])
        self.assertTrue(options.pending)
        self.assertTrue(options.retry_failed)
        self.assertFalse(_parser().parse_args(['--pending']).retry_failed)

    def test_help_tells_the_operator_how_to_recover_a_failed_document(self):
        # The gap was an operator who could not tell that a failed upload is
        # recoverable without re-uploading the file.
        actions = {name: action for action in _parser()._actions
                   for name in action.option_strings}
        self.assertIn('FAILED', actions['--retry-failed'].help)
        self.assertIn('--retry-failed', actions['--pending'].help)

    def test_retry_failed_without_a_drain_is_an_error(self):
        # Ignoring it would report success for a run that drained nothing.
        parser = _parser()
        options = vars(parser.parse_args(['--subject', 's']))
        options.update(path=None, retry_failed=True, pending=False, loop=False)
        with self.assertRaises(CommandError) as caught:
            ingest_cmd.Command().handle(**options)
        self.assertIn('--retry-failed', str(caught.exception))
