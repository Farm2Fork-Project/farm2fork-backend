#!/usr/bin/env bash
# Consistent cold Fabric snapshot; do not restore over a running ledger.
set -euo pipefail
ROOT=${F2F_ROOT:-/opt/farm2fork}
mode=${1:-fabric}
[[ "$mode" == fabric ]] || exit 2
mkdir -p "$ROOT/backups"
chmod 700 "$ROOT/backups"
backup="$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$backup"
dc() { docker compose --env-file "$ROOT/backend.env" --env-file "$ROOT/deployment-images.env" -f "$ROOT/ops/compose.yml" "$@"; }
# Download the snapshot utility before stopping any service.
docker image inspect alpine:3.23 >/dev/null 2>&1 || docker pull alpine:3.23 >/dev/null
test "$(df --output=avail -B1 "$ROOT" | tail -1)" -gt 4294967296
worker_was_running=$(dc ps -q backend-worker)
WORKER_WAS_RUNNING="$worker_was_running" python3 - "$ROOT/deployment-state/backup-in-progress.json" <<'PY'
import os,pathlib,json,sys
path=pathlib.Path(sys.argv[1])
temp=path.with_suffix('.tmp')
temp.write_text(json.dumps({'worker_was_running':bool(os.environ['WORKER_WAS_RUNNING'])}))
temp.chmod(0o644)
temp.replace(path)
PY
recover() {
  docker start orderer.farm2fork.com peer0.farm2fork.com >/dev/null
  if [[ -n "$worker_was_running" ]]; then dc up -d --no-deps backend-worker >/dev/null; fi
  rm -f "$ROOT/deployment-state/backup-in-progress.json"
}
trap recover EXIT
dc stop backend-worker >/dev/null
docker stop peer0.farm2fork.com orderer.farm2fork.com >/dev/null
for volume in farm2forkfabric_peer0.farm2fork.com farm2forkfabric_orderer.farm2fork.com; do
  docker run --rm --network none -v "$volume:/source:ro" -v "$backup:/backup" alpine:3.23 \
    sh -c 'tar -czf "/backup/$1.tgz" -C /source .' sh "$volume"
done
tar -czf "$backup/identities-and-channel.tgz" -C "$ROOT/farm2fork-blockchain/network" organizations channel-artifacts
cp "$ROOT/ops/compose.yml" "$ROOT/deployment-images.env" "$backup/"
find "$backup" -type f -exec chmod 600 {} +
echo "Fabric snapshot saved to $backup"
