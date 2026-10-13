#!/usr/bin/env python3
"""Root-owned, outbound-only release consumer. No production credentials in CI."""
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(os.environ.get('F2F_ROOT', '/opt/farm2fork'))
OPS = ROOT / 'ops'
STATE = ROOT / 'deployment-state'
ARTIFACTS = ROOT / 'deployment-artifacts'
REPOS = {name: f'Farm2Fork-Project/farm2fork-{name}' for name in ('backend', 'ai', 'blockchain')}
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'[0-9a-f]{64}')


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with temp.open('w') as stream:
        json.dump(data, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    temp.chmod(0o644)
    os.replace(temp, path)


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else {}


def validate_manifest(manifest, component, sha):
    if component not in REPOS or not SHA.fullmatch(sha):
        raise ValueError('Invalid component or source SHA')
    if (manifest.get('schema') != 1 or manifest.get('component') != component
            or manifest.get('sha') != sha or not DIGEST.fullmatch(manifest.get('sha256', ''))):
        raise ValueError('Manifest does not match requested release')
    artifact = 'chaincode.tar.gz' if component == 'blockchain' else 'image.tar.gz'
    if manifest.get('artifact') != artifact:
        raise ValueError('Invalid artifact path')
    if component == 'blockchain':
        if (not DIGEST.fullmatch(manifest.get('source_hash', ''))
                or manifest.get('label') != 'farm2fork-' + sha):
            raise ValueError('Invalid chaincode release')
    elif manifest.get('image') != f'farm2fork-{component}:{sha}':
        raise ValueError('Unexpected image name')


def should_attempt(state, sha):
    return not (state.get('deployed_sha') == sha or
                (state.get('attempted_sha') == sha and state.get('status') in ('failed', 'rolled_back')))


def run(args, timeout=180, capture=False):
    result = subprocess.run([str(x) for x in args], cwd=ROOT, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        # Application output can contain credentials; do not echo arbitrary stderr.
        raise RuntimeError(f'{pathlib.Path(str(args[0])).name} failed (exit {result.returncode})')
    if capture:
        return result.stdout.strip()
    return None


def dc(*args, **kwargs):
    return run(['docker', 'compose', '--env-file', ROOT / 'backend.env', '--env-file',
                ROOT / 'deployment-images.env', '-f', OPS / 'compose.yml', *args], **kwargs)


def main_sha(component):
    output = run(['git', 'ls-remote', f'https://github.com/{REPOS[component]}.git',
                  'refs/heads/main'], capture=True, timeout=45)
    sha = output.split()[0]
    if not SHA.fullmatch(sha):
        raise ValueError('Invalid main reference')
    return sha


def download(url, destination, maximum):
    request = urllib.request.Request(url, headers={'User-Agent': 'Farm2Fork-deployer/1'})
    try:
        response = urllib.request.urlopen(request, timeout=90)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise
    part = destination.with_suffix(destination.suffix + '.part')
    try:
        with response, part.open('wb') as stream:
            size = 0
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > maximum:
                    raise ValueError('Artifact exceeds size limit')
                stream.write(block)
        os.replace(part, destination)
        return True
    finally:
        part.unlink(missing_ok=True)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_provenance(path, bundle, component, sha):
    repo = REPOS[component]
    workflow = repo + '/.github/workflows/deploy.yml'
    run(['gh', 'attestation', 'verify', path, '--bundle', bundle,
         '--repo', repo, '--source-ref', 'refs/heads/main', '--source-digest', sha,
         '--signer-workflow', workflow, '--deny-self-hosted-runners',
         '--cert-identity', 'https://github.com/' + workflow + '@refs/heads/main'], timeout=120)


def images():
    return dict(line.split('=', 1) for line in (ROOT / 'deployment-images.env').read_text().splitlines()
                if '=' in line and not line.startswith('#'))


def write_images(values):
    path = ROOT / 'deployment-images.env'
    temp = path.with_suffix('.tmp')
    temp.write_text(''.join(f'{key}={value}\n' for key, value in sorted(values.items())))
    temp.chmod(0o600)
    os.replace(temp, path)


def wait_http(container, component, tries=45):
    if component == 'ai':
        command = ['python', '/ops/ai-probe.py']
    else:
        command = ['node', '-e', "fetch('http://127.0.0.1:3000/api/health', {signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok || (await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"]
    for _ in range(tries):
        try:
            run(['docker', 'exec', container, *command], timeout=15)
            return
        except (RuntimeError, subprocess.TimeoutExpired):
            time.sleep(2)
    raise RuntimeError(f'{component} readiness failed')


def dependency_probe():
    container = dc('ps', '-q', 'backend-worker', capture=True)
    before = json.loads(run(['docker', 'inspect', container], capture=True))[0]
    dc('exec', '-T', '-e', 'BLOCKCHAIN_WORKER_ENABLED=false', '-e', 'FABRIC_READ_ENABLED=true',
       'backend-worker', 'node', '/ops/readiness.cjs', timeout=90)
    time.sleep(8)
    status = json.loads(run(['docker', 'inspect', container], capture=True))[0]
    if (not status['State']['Running'] or status['RestartCount'] != before['RestartCount']
            or status['State']['StartedAt'] != before['State']['StartedAt']):
        raise RuntimeError('Worker is not stable')


def deploy_image(component, manifest, artifact, prior):
    old = images()
    new = dict(old)
    new[component.upper() + '_IMAGE'] = manifest['image']
    # Check free space before Docker extracts the compressed image.
    if shutil.disk_usage(ROOT).free < 4 * 1024**3:
        raise RuntimeError('Less than 4 GiB free before image activation')
    run(['docker', 'load', '-i', artifact], timeout=600)
    atomic_json(STATE / 'transaction.json', {'component': component, 'sha': manifest['sha'],
                'old_images': old})
    write_images(new)
    candidate = 'f2f-candidate-' + component
    run(['docker', 'rm', '-f', candidate], capture=True) if run(
        ['docker', 'ps', '-aq', '--filter', 'name=^/' + candidate + '$'], capture=True) else None
    switched = False
    try:
        dc('run', '-d', '--no-deps', '--name', candidate, component)
        wait_http(candidate, component)
        # Detect a newer merge before changing running services.
        if main_sha(component) != manifest['sha']:
            raise RuntimeError('Release superseded before activation')
        switched = True
        dc('stop', component, *(['backend-worker'] if component == 'backend' else []))
        dc('up', '-d', '--no-deps', component, *(['backend-worker'] if component == 'backend' else []))
        container = dc('ps', '-q', component, capture=True)
        wait_http(container, component)
        dependency_probe()
        prior['previous_image'] = old[component.upper() + '_IMAGE']
        prior['current_image'] = manifest['image']
    except Exception:
        write_images(old)
        if switched:
            dc('up', '-d', '--no-deps', component, *(['backend-worker'] if component == 'backend' else []))
            wait_http(dc('ps', '-q', component, capture=True), component)
            dependency_probe()
            prior['recovery'] = 'previous image restored and checked'
        else:
            prior['recovery'] = 'candidate rejected; running services unchanged'
        raise
    finally:
        with contextlib.suppress(RuntimeError):
            run(['docker', 'rm', '-f', candidate])
        # Archives are redownloadable; keep Docker's current/previous images.
        artifact.unlink(missing_ok=True)


def deploy_blockchain(manifest, artifact, prior):
    old = read_json(STATE / 'chaincode-current.json')
    if old.get('source_hash') == manifest['source_hash']:
        run(['bash', OPS / 'fabric-release.sh', 'verify'], timeout=90)
        return
    if not old.get('package') or not pathlib.Path(old['package']).is_file():
        raise RuntimeError('Previous chaincode package is required for forward recovery')
    atomic_json(STATE / 'transaction.json', {'component': 'blockchain', 'sha': manifest['sha'],
                'old_chaincode': old, 'phase': 'preparing'})
    run(['bash', OPS / 'backup.sh', 'fabric'], timeout=240)
    wait_fabric()
    dc('stop', 'backend-worker')
    atomic_json(STATE / 'transaction.json', {'component': 'blockchain', 'sha': manifest['sha'],
                'old_chaincode': old, 'phase': 'upgrading'})
    try:
        run(['bash', OPS / 'fabric-release.sh', 'deploy', artifact, manifest['sha']], timeout=600)
        dc('up', '-d', '--no-deps', 'backend-worker')
        dependency_probe()
    except Exception:
        # Always use the committed sequence + 1; never rewind live ledger state.
        run(['bash', OPS / 'fabric-release.sh', 'deploy', old['package'], old['sha']], timeout=600)
        dc('up', '-d', '--no-deps', 'backend-worker')
        dependency_probe()
        prior['recovery'] = 'previous chaincode redeployed at a higher sequence'
        raise
    atomic_json(STATE / 'chaincode-current.json', {'sha': manifest['sha'],
                'source_hash': manifest['source_hash'], 'package': str(artifact)})


def process(component):
    path = STATE / f'{component}.json'
    previous = read_json(path)
    sha = main_sha(component)
    if not should_attempt(previous, sha):
        return
    folder = ARTIFACTS / component / sha
    folder.mkdir(parents=True, exist_ok=True)
    base = f'https://github.com/{REPOS[component]}/releases/download/deploy-{sha}'
    manifest_path = folder / 'manifest.json'
    if not download(base + '/manifest.json', manifest_path, 65536):
        return  # CI has not published this commit yet.
    status = dict(previous, attempted_sha=sha, status='deploying',
                  started_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    status.pop('recovery', None)
    status.pop('error', None)
    atomic_json(path, status)
    try:
        manifest = read_json(manifest_path)
        validate_manifest(manifest, component, sha)
        artifact = folder / manifest['artifact']
        if not artifact.exists() or digest(artifact) != manifest['sha256']:
            if not download(base + '/' + manifest['artifact'], artifact, 2 * 1024**3):
                raise RuntimeError('Release artifact missing')
        if digest(artifact) != manifest['sha256']:
            artifact.unlink(missing_ok=True)
            raise ValueError('Artifact digest mismatch')
        bundle = folder / 'attestation.json'
        if not download(base + '/attestation.json', bundle, 5 * 1024**2):
            raise RuntimeError('Signed provenance bundle missing')
        verify_provenance(manifest_path, bundle, component, sha)
        verify_provenance(artifact, bundle, component, sha)
        if main_sha(component) != sha:
            status['status'] = 'superseded'
            atomic_json(path, status)
            return
        print(f'Activating {component} {sha}', flush=True)
        if component == 'blockchain':
            deploy_blockchain(manifest, artifact, status)
        else:
            deploy_image(component, manifest, artifact, status)
        status.update(status='success', deployed_sha=sha,
                      completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        atomic_json(path, status)
        (STATE / 'transaction.json').unlink(missing_ok=True)
        print(f'Activated {component} {sha}', flush=True)
    except Exception as error:
        status.update(status='rolled_back' if status.get('recovery') else 'failed',
                      error=str(error), completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        atomic_json(path, status)
        if status.get('recovery'):
            (STATE / 'transaction.json').unlink(missing_ok=True)
        print(f'Deployment failed for {component}: {error}', flush=True)
        if (STATE / 'transaction.json').exists():
            raise RuntimeError('Outstanding recovery must complete before another deployment') from error


def wait_fabric():
    for _ in range(20):
        try:
            # Recovery must not depend on a potentially broken new chaincode.
            run(['bash', OPS / 'fabric-release.sh', 'ready'], timeout=20)
            return
        except (RuntimeError, subprocess.TimeoutExpired):
            time.sleep(2)
    raise RuntimeError('Fabric not ready after restart')


def recover_interrupted():
    backup = STATE / 'backup-in-progress.json'
    if backup.exists():
        marker = read_json(backup)
        run(['docker', 'start', 'orderer.farm2fork.com', 'peer0.farm2fork.com'])
        wait_fabric()
        if marker['worker_was_running'] and not (STATE / 'transaction.json').exists():
            dc('up', '-d', '--no-deps', 'backend-worker')
        backup.unlink()
    path = STATE / 'transaction.json'
    if not path.exists():
        return
    transaction = read_json(path)
    component, sha = transaction['component'], transaction['sha']
    status_path = STATE / (component + '.json')
    status = read_json(status_path)
    if status.get('status') == 'success' and status.get('deployed_sha') == sha:
        path.unlink()
        return
    print('Recovering interrupted ' + component + ' deployment', flush=True)
    if component == 'blockchain':
        old = transaction['old_chaincode']
        run(['docker', 'start', 'orderer.farm2fork.com', 'peer0.farm2fork.com'])
        wait_fabric()
        dc('stop', 'backend-worker')
        if transaction.get('phase') != 'preparing':
            run(['bash', OPS / 'fabric-release.sh', 'deploy', old['package'], old['sha']], timeout=600)
        atomic_json(STATE / 'chaincode-current.json', old)
        dc('up', '-d', '--no-deps', 'backend-worker')
    else:
        write_images(transaction['old_images'])
        dc('up', '-d', '--no-deps', component, *(['backend-worker'] if component == 'backend' else []))
        wait_http(dc('ps', '-q', component, capture=True), component)
    dependency_probe()
    status.update(status='rolled_back', attempted_sha=sha, recovery='interrupted release recovered',
                  completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    atomic_json(status_path, status)
    path.unlink()


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / '.deployment.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        recover_interrupted()
        components = sys.argv[1:] or ['blockchain', 'ai', 'backend']
        for component in components:
            if component not in REPOS:
                raise ValueError('Unknown component')
            try:
                process(component)
            except Exception as error:
                print(f'Poll failed for {component}: {type(error).__name__}', flush=True)
                if (STATE / 'transaction.json').exists():
                    raise


if __name__ == '__main__':
    main()
