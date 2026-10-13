import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('agent', pathlib.Path(__file__).parents[1] / 'deploy-agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class ReleaseTests(unittest.TestCase):
    def manifest(self):
        return {'schema': 1, 'component': 'backend', 'sha': 'a' * 40,
                'artifact': 'image.tar.gz', 'sha256': 'b' * 64,
                'image': 'farm2fork-backend:' + 'a' * 40}

    def test_accepts_exact_sha_and_image(self):
        agent.validate_manifest(self.manifest(), 'backend', 'a' * 40)

    def test_rejects_cross_component_stale_sha_and_path_traversal(self):
        for key, value in [('component', 'ai'), ('sha', 'c' * 40),
                           ('artifact', '../image.tar.gz'), ('sha256', 'invalid'),
                           ('image', 'attacker:latest')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                manifest = self.manifest()
                manifest[key] = value
                agent.validate_manifest(manifest, 'backend', 'a' * 40)

    def test_rejects_non_hex_sha(self):
        with self.assertRaises(ValueError):
            agent.validate_manifest(self.manifest(), 'backend', '$(id)')

    def test_atomic_state_and_failed_sha_retry_policy(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'backend.json'
            agent.atomic_json(path, {'attempted_sha': 'a' * 40, 'status': 'failed'})
            self.assertEqual(json.loads(path.read_text())['status'], 'failed')
            self.assertFalse(agent.should_attempt(json.loads(path.read_text()), 'a' * 40))
            self.assertTrue(agent.should_attempt(json.loads(path.read_text()), 'b' * 40))
            self.assertEqual(list(path.parent.glob('*.tmp')), [])

    def test_pending_sha_is_recoverable_after_interrupted_deployment(self):
        self.assertTrue(agent.should_attempt({'status': 'deploying', 'attempted_sha': 'a' * 40}, 'a' * 40))

    def test_chaincode_manifest_requires_source_hash_and_fixed_artifact(self):
        manifest = {'schema': 1, 'component': 'blockchain', 'sha': 'a' * 40,
                    'artifact': 'chaincode.tar.gz', 'sha256': 'b' * 64,
                    'source_hash': 'c' * 64, 'label': 'farm2fork-' + 'a' * 40}
        agent.validate_manifest(manifest, 'blockchain', 'a' * 40)
        manifest['source_hash'] = 'bad'
        with self.assertRaises(ValueError):
            agent.validate_manifest(manifest, 'blockchain', 'a' * 40)

    def test_failed_activation_restores_previous_image_and_checks_recovery(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(agent, 'STATE', pathlib.Path(folder)), \
                mock.patch.object(agent, 'images', return_value={'BACKEND_IMAGE': 'old', 'AI_IMAGE': 'ai'}), \
                mock.patch.object(agent, 'write_images') as write, \
                mock.patch.object(agent, 'run', return_value=''), \
                mock.patch.object(agent, 'dc', return_value='running'), \
                mock.patch.object(agent, 'main_sha', return_value='a' * 40), \
                mock.patch.object(agent, 'dependency_probe') as probe, \
                mock.patch.object(agent, 'wait_http', side_effect=[None, RuntimeError('bad'), None]), \
                mock.patch.object(agent.shutil, 'disk_usage', return_value=mock.Mock(free=10 * 1024**3)):
            artifact = pathlib.Path(folder) / 'image.tar.gz'
            artifact.touch()
            state = {}
            with self.assertRaises(RuntimeError):
                agent.deploy_image('backend', self.manifest(), artifact, state)
            self.assertEqual(write.call_args.args[0]['BACKEND_IMAGE'], 'old')
            self.assertEqual(state['recovery'], 'previous image restored and checked')
            probe.assert_called_once()

    def test_unchanged_chaincode_only_verifies_without_snapshot_or_upgrade(self):
        with mock.patch.object(agent, 'read_json', return_value={'source_hash': 'c' * 64}), \
                mock.patch.object(agent, 'run') as run:
            agent.deploy_blockchain({'source_hash': 'c' * 64}, pathlib.Path('package'), {})
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][-1], 'verify')

    def test_interrupted_image_release_recovers_old_images(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(agent, 'STATE', pathlib.Path(folder)), \
                mock.patch.object(agent, 'write_images') as write, \
                mock.patch.object(agent, 'dc', return_value='running'), \
                mock.patch.object(agent, 'wait_http'), mock.patch.object(agent, 'dependency_probe'):
            state = pathlib.Path(folder)
            agent.atomic_json(state / 'transaction.json', {'component': 'ai', 'sha': 'a' * 40,
                              'old_images': {'BACKEND_IMAGE': 'backend', 'AI_IMAGE': 'old'}})
            agent.atomic_json(state / 'ai.json', {'status': 'deploying', 'deployed_sha': 'b' * 40})
            agent.recover_interrupted()
            self.assertEqual(write.call_args.args[0]['AI_IMAGE'], 'old')
            self.assertEqual(agent.read_json(state / 'ai.json')['status'], 'rolled_back')
            self.assertFalse((state / 'transaction.json').exists())


if __name__ == '__main__':
    unittest.main()
