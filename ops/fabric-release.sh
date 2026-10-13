#!/usr/bin/env bash
# This deployment entrypoint deliberately never calls network-up/down/reset.
set -euo pipefail
ROOT=${F2F_ROOT:-/opt/farm2fork}
source "$ROOT/farm2fork-blockchain/network/scripts/env.sh"

ready() {
  peer_cmd peer channel getinfo -c "$CHANNEL_NAME" >/dev/null
  peer_cmd peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" --output json >/dev/null
}

verify() {
  ready
  peer_cmd peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" --output json
  peer_cmd peer chaincode query -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" \
    -c '{"Args":["GetTransactionsByProductId","deployment-read-probe"]}' >/dev/null
}

case ${1:-} in
  ready) ready ;;
  verify) verify ;;
  deploy)
    package=${2:?package path required}
    version=${3:?source SHA required}
    [[ "$version" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid source SHA'; exit 1; }
    test -f "$package"
    current=$(peer_cmd peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" --output json)
    sequence=$(python3 -c 'import json,sys; print(int(json.load(sys.stdin)["sequence"])+1)' <<< "$current")
    package_id=$(peer_host_cmd peer lifecycle chaincode calculatepackageid "$package")
    docker cp "$package" "$PEER_CONTAINER_NAME:/tmp/farm2fork-release.tar.gz"
    installed=$(peer_cmd peer lifecycle chaincode queryinstalled --output json)
    if ! PACKAGE_ID="$package_id" python3 -c 'import json,sys,os; sys.exit(0 if any(p["package_id"]==os.environ["PACKAGE_ID"] for p in json.load(sys.stdin)["installed_chaincodes"]) else 1)' <<< "$installed"; then
      peer_cmd peer lifecycle chaincode install /tmp/farm2fork-release.tar.gz
    fi
    peer_cmd peer lifecycle chaincode approveformyorg \
      -o "$ORDERER_ADDRESS" -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" \
      --version "$version" --sequence "$sequence" --package-id "$package_id" \
      --tls --cafile "$ORDERER_CA_FILE"
    ready=$(peer_cmd peer lifecycle chaincode checkcommitreadiness \
      -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" --version "$version" \
      --sequence "$sequence" --output json)
    python3 -c 'import json,sys; assert json.load(sys.stdin)["approvals"]["Farm2ForkMSP"] is True' <<< "$ready"
    peer_cmd peer lifecycle chaincode commit \
      -o "$ORDERER_ADDRESS" -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" \
      --version "$version" --sequence "$sequence" \
      --peerAddresses peer0.farm2fork.com:7051 --tlsRootCertFiles "$PEER_TLS_CA_FILE" \
      --tls --cafile "$ORDERER_CA_FILE" --waitForEvent --waitForEventTimeout 60s
    committed=$(peer_cmd peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" --output json)
    VERSION="$version" SEQUENCE="$sequence" python3 -c 'import json,sys,os; d=json.load(sys.stdin); assert d["version"]==os.environ["VERSION"] and d["sequence"]==int(os.environ["SEQUENCE"])' <<< "$committed"
    verify
    docker ps -q --filter network=farm2fork-fabric | xargs -r docker update --restart unless-stopped >/dev/null
    ;;
  *) echo 'Usage: fabric-release.sh ready | verify | deploy PACKAGE SOURCE_SHA' >&2; exit 2 ;;
esac
