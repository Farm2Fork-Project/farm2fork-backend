import http.server
import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('status', pathlib.Path(__file__).parents[1] / 'status-server.py')
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        status.STATE = pathlib.Path(self.temp.name)
        (status.STATE / 'backend.json').write_text(json.dumps({'status': 'success', 'deployed_sha': 'a' * 40,
                                                              'error': 'private details', 'package': '/private'}))
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), status.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def test_returns_uncached_receipt_without_operational_secrets(self):
        with urllib.request.urlopen(self.url + '/_deploy/status/backend?sha=abc') as response:
            self.assertIn('no-store', response.headers['Cache-Control'])
            self.assertEqual(json.load(response), {'status': 'success', 'deployed_sha': 'a' * 40})

    def test_arbitrary_paths_and_write_methods_are_rejected(self):
        for path in ['/backend.json', '/_deploy/status/../backend', '/_deploy/status/backend/other']:
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.url + path)
            self.assertEqual(error.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(urllib.request.Request(self.url + '/_deploy/status/backend', data=b'{}'))
        self.assertEqual(error.exception.code, 501)
