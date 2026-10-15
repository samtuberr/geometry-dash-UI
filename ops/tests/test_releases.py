"""Fault-injection tests of the actual transaction code, without cloud access."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[1] / 'host/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

REPOSITORY = 'us-central1-docker.pkg.dev/geometrydash-ui-test/geometrydash-ui-production/web'


def image(letter):
    return REPOSITORY + '@sha256:' + letter * 64


class SimulatedHost(release.Releases):
    def __init__(self, root):
        super().__init__(root, {'domain': 'geometrydash-ui.example.com', 'image_repository': REPOSITORY})
        self.serving = None
        self.prepared = []
        self.events = []
        self.fail_at = None
        self.fail_restore = False

    def prepare(self, candidate):
        self.prepared.append(candidate)
        if self.fail_at == 'prepare':
            raise RuntimeError('Unhealthy image')

    def switch(self, candidate):
        if self.fail_restore and candidate and candidate['revision'] == 'a' * 40:
            raise RuntimeError('Proxy cannot reload')
        self.serving = candidate

    def tls(self):
        if self.fail_at == 'tls':
            raise RuntimeError('Certificate validation failed')

    def public_check(self, candidate):
        if self.fail_at == 'public':
            raise RuntimeError('Wrong public version')

    def event(self, event, **fields):
        self.events.append((event, fields))


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.host = SimulatedHost(Path(self.temp.name))

    def first(self):
        self.host.deploy(image('a'), 'a' * 40)

    def test_success_preserves_previous_digest_and_alternates_ports(self):
        self.first()
        self.host.deploy(image('b'), 'b' * 40)
        self.assertEqual(self.host.state()['current']['port'], 8082)
        self.assertEqual(self.host.state()['previous']['image'], image('a'))
        self.host.deploy(image('c'), 'c' * 40)
        self.assertEqual(self.host.state()['current']['port'], 8081)
        self.assertEqual(self.host.state()['previous']['image'], image('b'))
        self.assertFalse(self.host.pending_path.exists())

    def test_candidate_tls_and_post_switch_failures_restore_committed_release(self):
        self.first()
        before = self.host.state()
        for failure in ['prepare', 'tls', 'public']:
            with self.subTest(failure=failure):
                self.host.fail_at = failure
                with self.assertRaises(RuntimeError):
                    self.host.deploy(image('b'), 'b' * 40)
                self.assertEqual(self.host.state(), before)
                self.assertEqual(self.host.serving, before['current'])
                self.assertFalse(self.host.pending_path.exists())

    def test_failed_initial_release_does_not_become_current(self):
        self.host.fail_at = 'public'
        with self.assertRaises(RuntimeError):
            self.first()
        self.assertIsNone(self.host.state()['current'])
        self.assertIsNone(self.host.serving)

    def test_manual_rollback_uses_previous_digest_without_rebuild(self):
        self.first()
        self.host.deploy(image('b'), 'b' * 40)
        self.host.rollback()
        self.assertEqual(self.host.state()['current']['image'], image('a'))
        self.assertEqual(self.host.state()['previous']['image'], image('b'))

    def test_power_loss_after_switch_but_before_commit_reverts(self):
        self.first()
        before = self.host.state()
        candidate = {'image': image('b'), 'revision': 'b' * 40, 'port': 8082}
        release.atomic_json(self.host.pending_path, {'before': before, 'candidate': candidate})
        self.host.serving = candidate
        self.host.recover()
        self.assertEqual(self.host.state(), before)
        self.assertEqual(self.host.serving, before['current'])
        self.assertFalse(self.host.pending_path.exists())

    def test_power_loss_after_state_write_but_before_commit_marker_reverts(self):
        self.first()
        before = self.host.state()
        candidate = {'image': image('b'), 'revision': 'b' * 40, 'port': 8082}
        release.atomic_json(self.host.pending_path, {'before': before, 'candidate': candidate})
        release.atomic_json(self.host.state_path, {'current': candidate, 'previous': before['current']})
        self.host.recover()
        self.assertEqual(self.host.state(), before)

    def test_failed_restore_keeps_journal_for_next_recovery_attempt(self):
        self.first()
        self.host.fail_at = 'public'
        self.host.fail_restore = True
        with self.assertRaises(RuntimeError):
            self.host.deploy(image('b'), 'b' * 40)
        self.assertTrue(self.host.pending_path.exists())
        self.host.fail_at = None
        self.host.fail_restore = False
        self.host.recover()
        self.assertEqual(self.host.state()['current']['image'], image('a'))

    def test_same_digest_is_idempotent(self):
        self.first()
        self.first()
        self.assertEqual(len(self.host.prepared), 1)
        self.assertIsNone(self.host.state()['previous'])

    def test_same_digest_cannot_claim_another_commit(self):
        self.first()
        with self.assertRaises(ValueError):
            self.host.deploy(image('a'), 'b' * 40)

    def test_no_previous_release_fails_clearly(self):
        self.first()
        with self.assertRaisesRegex(ValueError, 'No previous'):
            self.host.rollback()

    def test_mutable_tags_other_projects_and_command_injection_rejected(self):
        for candidate in [REPOSITORY + ':latest', image('a').replace('geometrydash-ui-test/', 'other-project/'), image('a') + ';id']:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                self.host.deploy(candidate, 'a' * 40)
        with self.assertRaises(ValueError):
            self.host.deploy(image('a'), 'main;id')
        self.assertFalse(self.host.pending_path.exists())


if __name__ == '__main__':
    unittest.main()
