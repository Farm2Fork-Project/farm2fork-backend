#!/usr/bin/env python3
"""Public read-only release receipts; no command execution or secret-bearing logs."""
import http.server
import json
import os
import pathlib
import urllib.parse

STATE = pathlib.Path(os.environ.get('F2F_STATE', '/state'))


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path_name = urllib.parse.urlsplit(self.path).path
        component = path_name.removeprefix('/_deploy/status/')
        if path_name != '/_deploy/status/' + component or component not in ('backend', 'ai', 'blockchain'):
            self.send_error(404)
            return
        path = STATE / (component + '.json')
        state = json.loads(path.read_text()) if path.exists() else {'status': 'pending'}
        # Do not expose image paths, private operational errors or recovery logs.
        receipt = {key: state[key] for key in ('status', 'deployed_sha', 'attempted_sha',
                   'started_at', 'completed_at') if key in state}
        body = json.dumps(receipt).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('0.0.0.0', 9010), Handler).serve_forever()
