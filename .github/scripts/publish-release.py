#!/usr/bin/env python3
"""Publish all assets atomically. Existing commit releases are immutable."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys

component = sys.argv[1]
sha = os.environ['GITHUB_SHA']
tag = 'deploy-' + sha
artifact = pathlib.Path('chaincode.tar.gz' if component == 'blockchain' else 'image.tar.gz')
with artifact.open('rb') as stream:
    checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
manifest = {'schema': 1, 'component': component, 'sha': sha,
            'artifact': artifact.name, 'sha256': checksum}
if component == 'blockchain':
    source = hashlib.sha256()
    paths = subprocess.check_output(['git', 'ls-files', '-z', 'chaincode/farm2fork-chaincode']).split(b'\0')
    for raw in sorted(filter(None, paths)):
        source.update(raw + b'\0' + pathlib.Path(os.fsdecode(raw)).read_bytes() + b'\0')
    manifest.update(source_hash=source.hexdigest(), label='farm2fork-' + sha)
else:
    manifest['image'] = f'farm2fork-{component}:{sha}'
pathlib.Path('manifest.json').write_text(json.dumps(manifest, sort_keys=True) + '\n')
existing = subprocess.run(['gh', 'release', 'view', tag, '--json', 'isDraft'], capture_output=True, text=True)
if existing.returncode == 0:
    if not json.loads(existing.stdout)['isDraft']:
        print('Immutable release already published; checking activation next')
        sys.exit(0)
    # A failed draft has never been consumed by EC2; delete just the draft.
    subprocess.run(['gh', 'release', 'delete', tag, '--yes'], check=True)
subprocess.run(['gh', 'release', 'create', tag, '--target', sha, '--draft',
                '--title', component + ' ' + sha[:12], '--notes',
                'Tested deployment artifact for source commit ' + sha,
                str(artifact), 'manifest.json'], check=True)
subprocess.run(['gh', 'release', 'edit', tag, '--draft=false'], check=True)
