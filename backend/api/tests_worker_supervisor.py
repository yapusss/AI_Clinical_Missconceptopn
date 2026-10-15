"""Tests for the worker supervisor's guards and the heartbeat's failure contract.

Deliberately DB-free (`SimpleTestCase`): the suite the project runs
(`manage.py test api.tests_reference_materials`) never touches the database, because
almost every table here is unmanaged and owned by `V2_Full_Script.sql`. These tests
therefore cover the pure decisions (who may supervise) and the non-fatal contract of
the heartbeat writer, not the SQL itself — the live check for the SQL is:

    SELECT worker_name, now() - last_seen_at AS age, pid, loop_count
    FROM worker_heartbeats ORDER BY worker_name;

The most important case here is `test_never_supervises_a_test_run`: a test run that
spawned the analysis worker would call a real LLM provider and spend real money.
"""

from unittest import mock

import os

from django.test import SimpleTestCase, override_settings

from api import worker_health, worker_supervisor


class ShouldSuperviseTests(SimpleTestCase):

    @override_settings(AUTO_WORKER=True, LLM_API_KEY='gsk_a_real_looking_key')
    def test_supervises_a_runserver_with_a_real_key(self):
        ok, reason = worker_supervisor.should_supervise(['manage.py', 'runserver'])
        self.assertTrue(ok, reason)

    @override_settings(AUTO_WORKER=True, LLM_API_KEY='gsk_a_real_looking_key')
    def test_never_supervises_a_test_run(self):
        ok, reason = worker_supervisor.should_supervise(
            ['manage.py', 'test', 'api.tests_worker_supervisor']
        )
        self.assertFalse(ok)
        self.assertEqual(reason, 'test run')

    @override_settings(AUTO_WORKER=True, LLM_API_KEY='gsk_a_real_looking_key')
    def test_never_supervises_a_management_command(self):
        for argv in (['manage.py', 'migrate'], ['manage.py', 'shell'],
                     ['manage.py', 'analyze_submissions', '--loop'],
                     ['manage.py', 'drain_reading_materials', '--loop']):
            ok, _ = worker_supervisor.should_supervise(argv)
            self.assertFalse(ok, argv)

    @override_settings(AUTO_WORKER=False, LLM_API_KEY='gsk_a_real_looking_key')
    def test_operator_switch_off_wins(self):
        ok, reason = worker_supervisor.should_supervise(['manage.py', 'runserver'])
        self.assertFalse(ok)
        self.assertEqual(reason, 'AUTO_WORKER is off')

    @override_settings(AUTO_WORKER=True, LLM_API_KEY='local-llama-cpp')
    def test_placeholder_key_is_not_enough(self):
        ok, reason = worker_supervisor.should_supervise(['manage.py', 'runserver'])
        self.assertFalse(ok)
        self.assertIn('LLM key', reason)

    @override_settings(AUTO_WORKER=True, LLM_API_KEY='')
    def test_missing_key_is_not_enough(self):
        ok, _ = worker_supervisor.should_supervise(['manage.py', 'runserver'])
        self.assertFalse(ok)

    def test_default_argv_is_this_process(self):
        # Called with no argument it must inspect the running process, and under
        # `manage.py test` that means "no".
        ok, reason = worker_supervisor.should_supervise()
        self.assertFalse(ok)
        self.assertEqual(reason, 'test run')


class WorkerCommandTests(SimpleTestCase):

    def test_supervises_both_loop_workers(self):
        commands = dict(worker_supervisor.worker_commands())
        self.assertEqual(sorted(commands), ['analysis', 'materials'])
        for name, argv in commands.items():
            self.assertIn('--loop', argv, name)
            self.assertFalse(argv[0].startswith('manage.py'), name)


class SpawnTests(SimpleTestCase):
    """`_spawn` is the one place that must get the child's environment right."""

    def test_spawn_passes_the_supervisor_pid_to_the_child(self):
        from django.conf import settings

        with mock.patch.object(worker_supervisor.subprocess, 'Popen') as popen:
            worker_supervisor._spawn('analysis', ['analyze_submissions', '--loop'])

        args, kwargs = popen.call_args
        self.assertEqual(args[0][1:], ['manage.py', 'analyze_submissions', '--loop'])
        self.assertEqual(kwargs['cwd'], str(settings.BASE_DIR))
        # Without this the child cannot tell that it is supervised, and would outlive
        # a hard-killed supervisor as an orphan.
        self.assertEqual(
            kwargs['env'][worker_health.SUPERVISED_BY_ENV], str(os.getpid())
        )
        # The child needs the DB + LLM settings too.
        self.assertIn('PATH', kwargs['env'])


class HeartbeatFailureContractTests(SimpleTestCase):

    def test_record_heartbeat_never_raises_when_the_table_is_missing(self):
        # A worker started before `migrate` (or a DB blip) must keep working: the
        # heartbeat is diagnostics, never a precondition for the work.
        with mock.patch.object(worker_health, 'connection') as conn:
            conn.cursor.side_effect = RuntimeError('relation "worker_heartbeats" does not exist')
            worker_health.record_heartbeat('analysis', {'mode': 'loop'})  # must not raise

    def test_worker_status_returns_empty_when_unreachable(self):
        with mock.patch.object(worker_health, 'connection') as conn:
            conn.cursor.side_effect = RuntimeError('boom')
            self.assertEqual(worker_health.worker_status(), [])


class SupervisorGoneTests(SimpleTestCase):
    """A supervised worker must not outlive its supervisor as an orphan."""

    def _env(self, value):
        return mock.patch.dict(os.environ, {worker_health.SUPERVISED_BY_ENV: value})

    def test_manual_worker_never_self_terminates(self):
        # No ACM_SUPERVISED_BY means a human ran `--loop` in a terminal.
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(worker_health.SUPERVISED_BY_ENV, None)
            self.assertFalse(worker_health.supervisor_gone())

    def test_exits_when_no_supervisor_heartbeat_exists(self):
        with self._env('1234'):
            with mock.patch.object(worker_health, 'worker_status', return_value=[]):
                self.assertTrue(worker_health.supervisor_gone())

    def test_exits_when_a_newer_supervisor_owns_the_workers(self):
        # The backend was restarted: a different PID now writes the supervisor row.
        row = {'worker_name': 'supervisor', 'pid': 9999, 'age_seconds': 1.0}
        with self._env('1234'):
            with mock.patch.object(worker_health, 'worker_status', return_value=[row]):
                self.assertTrue(worker_health.supervisor_gone())

    def test_exits_when_the_supervisor_heartbeat_is_stale(self):
        row = {
            'worker_name': 'supervisor', 'pid': 1234,
            'age_seconds': worker_health.SUPERVISOR_STALE_AFTER + 1,
        }
        with self._env('1234'):
            with mock.patch.object(worker_health, 'worker_status', return_value=[row]):
                self.assertTrue(worker_health.supervisor_gone())

    def test_stays_while_its_own_supervisor_is_fresh(self):
        row = {'worker_name': 'supervisor', 'pid': 1234, 'age_seconds': 1.0}
        with self._env('1234'):
            with mock.patch.object(worker_health, 'worker_status', return_value=[row]):
                self.assertFalse(worker_health.supervisor_gone())


class ReferenceEmbeddingEmptyTextTests(SimpleTestCase):
    """One empty reference text must not fail the whole embedding batch."""

    def test_effective_text_is_empty_when_every_source_is_empty(self):
        from api.management.commands.sync_reference_embeddings import _effective_text

        for key in ('JAWABAN_SINGKAT', 'ALASAN'):
            self.assertEqual(_effective_text(key, '', None, None), '')
            self.assertEqual(_effective_text(key, '   ', '', '  '), '')

    def test_effective_text_prefers_the_short_answer_then_falls_back(self):
        from api.management.commands.sync_reference_embeddings import _effective_text

        self.assertEqual(
            _effective_text('JAWABAN_SINGKAT', 'short', 'model', 'fallback'), 'short'
        )
        self.assertEqual(
            _effective_text('ALASAN', 'short', 'model', 'fallback'), 'model'
        )
        self.assertEqual(
            _effective_text('ALASAN', '', '', 'fallback'), 'fallback'
        )
