#!/usr/bin/env python3
"""Actions reports activation or recovery rather than just successful publishing."""
import json
import os
import subprocess
import sys
import time

component, sha = sys.argv[1:]
url = 'https://api.farm2fork.tech/_deploy/status/' + component
for attempt in range(120):
    current = subprocess.check_output(['git', 'ls-remote', 'origin', 'refs/heads/main'], text=True).split()[0]
    if current != sha:
        print('A newer main commit superseded this release; its run will check deployment.')
        sys.exit(0)
    try:
        state = json.loads(subprocess.check_output([
            'curl', '--fail', '--silent', '--show-error', '--max-time', '15',
            '--header', 'Cache-Control: no-cache', url + '?sha=' + sha,
        ], text=True))
        if state.get('deployed_sha') == sha and state.get('status') == 'success':
            print(component + ' activated and checked on EC2: ' + sha)
            if path := os.environ.get('GITHUB_STEP_SUMMARY'):
                with open(path, 'a') as stream:
                    stream.write(f'{component} `{sha}` activated and checked on EC2.\n')
            sys.exit(0)
        if state.get('attempted_sha') == sha and state.get('status') in ('failed', 'rolled_back'):
            raise SystemExit('EC2 deployment failed or rolled back; inspect server deployment journal.')
    except Exception as error:
        if attempt % 6 == 0:
            print('Waiting for EC2 activation (' + type(error).__name__ + ')', flush=True)
    time.sleep(10)
raise SystemExit('Timed out waiting for EC2 deployment; publication alone is not deployment success.')
