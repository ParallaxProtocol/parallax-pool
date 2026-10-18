#!/usr/bin/env bash
#
# End-to-end test on a private Parallax chain, entirely in Docker:
#
#   two peered parallaxd nodes (custom genesis, frozen difficulty 1024, 100-block lockbox)
#   + PostgreSQL + the pool image built from this checkout (configured from environment variables)
#   + CPU miners for two addresses (tests/e2e/driver.py, hashing with the image's own libxhash)
#
# It mines until blocks have passed the coinbase lockbox and checks the outcome against the chain:
#   MODE=pool    (default) PPLNS payouts with a 1% fee; payout transactions mined, each miner's
#                on-chain balance equals what the API says it was paid
#   MODE=direct  direct rewards; blocks confirmed, no payouts, rewards at the pool address
#
# With DEV=1 (make dev) nothing is checked: the miners keep going and the web UI runs from ui/
# under Vite with hot reload on http://127.0.0.1:5173, against this pool. Ctrl+C stops everything.
#
# Usage: tests/e2e/run.sh            (or: make e2e / make e2e-direct / make dev)
#   KEEP=1         keep everything running afterwards (API and web UI on 127.0.0.1:$API_PORT)
#   MINER_THREADS  mining threads per test miner (default 2, 1 with DEV=1)
#   UI_PORT        host port for the Vite dev server with DEV=1 (default 5173)
#   SKIP_BUILD=1   reuse an existing parallax-pool:e2e image
#   API_PORT       host port for the pool API/UI (default 14000)
#   TIMEOUT        seconds to wait for matured blocks and payouts (default 900)
#   NODE_IMAGE     node image (default: the version docker-compose.yml uses)

set -euo pipefail

MODE=${MODE:-pool}
API_PORT=${API_PORT:-14000}
TIMEOUT=${TIMEOUT:-900}
NODE_IMAGE=${NODE_IMAGE:-parallaxprotocol/parallax:2.1.5}
POOL_IMAGE=parallax-pool:e2e
DB_IMAGE=postgres:17.11-alpine
DRIVER_IMAGE=python:3.13-slim
UI_IMAGE=node:24-slim
UI_PORT=${UI_PORT:-5173}
MINER_THREADS=${MINER_THREADS:-$([ "${DEV:-}" = 1 ] && echo 1 || echo 2)}
NET=pp-e2e
REPO=$(cd "$(dirname "$0")/../.." && pwd)

case "$MODE" in pool|direct) ;; *) echo "MODE must be pool or direct" >&2; exit 2 ;; esac

containers=(pp-e2e-node1 pp-e2e-node2 pp-e2e-db pp-e2e-pool pp-e2e-driver pp-e2e-ui)
volumes=(pp-e2e-node1 pp-e2e-node2)
WORK=$(mktemp -d)

say() { printf '\n== %s\n' "$*"; }

cleanup() {
    status=$?

    # Ctrl+C ends a DEV=1 session normally
    [ "${DEV:-}" = 1 ] && [ $status -eq 130 ] && status=0

    if [ $status -ne 0 ]; then
        say "failed, last pool and node logs"
        docker logs --tail 40 pp-e2e-pool 2>&1 || true
        docker logs --tail 15 pp-e2e-node1 2>&1 || true
    fi

    if [ "${KEEP:-}" = 1 ]; then
        say "KEEP=1: left running. Web UI and API: http://127.0.0.1:$API_PORT  (clean up: KEEP= $0 --cleanup-only)"
    else
        docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
        docker volume rm "${volumes[@]}" >/dev/null 2>&1 || true
        docker network rm "$NET" >/dev/null 2>&1 || true
    fi

    rm -rf "$WORK"
    exit $status
}

# leftovers from an earlier KEEP=1 or interrupted run
docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
docker volume rm "${volumes[@]}" >/dev/null 2>&1 || true
docker network rm "$NET" >/dev/null 2>&1 || true

if [ "${1:-}" = "--cleanup-only" ]; then
    rm -rf "$WORK"
    exit 0
fi

trap cleanup EXIT
trap 'exit 130' INT TERM

if [ "${SKIP_BUILD:-}" != 1 ]; then
    say "building $POOL_IMAGE"
    docker build -q -t "$POOL_IMAGE" "$REPO" >/dev/null
fi

docker network create "$NET" >/dev/null

# files shared with the containers (the node runs as uid 1000, so make them readable)
chmod 755 "$WORK"
cp "$REPO/tests/e2e/driver.py" "$WORK/"
cid=$(docker create "$POOL_IMAGE")
docker cp -q "$cid:/app/libxhash.so" "$WORK/libxhash.so"
docker rm "$cid" >/dev/null
echo "e2e-test-password" > "$WORK/password"

# difficulty 1024 and retargeting pushed out of reach keep blocks coming every second or two;
# the lockbox address needs a non-zero balance or EIP-158 cleanup drops scheduled rewards
cat > "$WORK/genesis.json" <<'EOF'
{
  "config": {
    "chainId": 2112, "homesteadBlock": 0, "eip150Block": 0, "eip155Block": 0, "eip158Block": 0,
    "byzantiumBlock": 0, "constantinopleBlock": 0, "petersburgBlock": 0, "istanbulBlock": 0, "berlinBlock": 0,
    "xhash": { "coinbaseMaturityBlocks": 100, "retargetIntervalBlocks": 1000000000, "asertAnchorHeight": 1000000000 }
  },
  "nonce": "0x0", "timestamp": "0x0", "extraData": "0x", "gasLimit": "0x23c34600", "difficulty": "0x400",
  "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "coinbase": "0x0000000000000000000000000000000000000000",
  "alloc": { "0000000000000000000000000000000000000042": { "balance": "0x1" } },
  "number": "0x0", "gasUsed": "0x0",
  "parentHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
}
EOF
chmod 644 "$WORK"/*

node_tool() {
    local volume=$1; shift
    docker run --rm -v "$volume:/home/parallax/.parallax" -v "$WORK:/e2e:ro" --entrypoint "$1" "$NODE_IMAGE" "${@:2}"
}

say "creating the chain"
unlock=()

if [ "$MODE" = pool ]; then
    # payouts are sent by the node from the pool address, so the node holds its key
    POOL_ADDRESS=$(node_tool pp-e2e-node1 parallax-wallet new --datadir /home/parallax/.parallax --password /e2e/password --lightkdf \
        | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
    unlock=(--unlock "$POOL_ADDRESS" --password /e2e/password --allow-insecure-unlock)
else
    POOL_ADDRESS=0x3333333333333333333333333333333333333333
fi

echo "pool address $POOL_ADDRESS"

for volume in pp-e2e-node1 pp-e2e-node2; do
    node_tool "$volume" parallaxd --datadir /home/parallax/.parallax init /e2e/genesis.json >/dev/null 2>&1
done

node_flags=(--networkid 2112 --nodiscover --dnsseed= --nat none --listenonion=false --ipcdisable --syncmode full
    --http --http.addr 0.0.0.0 --http.vhosts '*' --http.api eth,net,web3,admin --verbosity 2)

say "starting nodes, database and pool"
docker run -d --name pp-e2e-node1 --network "$NET" -v pp-e2e-node1:/home/parallax/.parallax -v "$WORK:/e2e:ro" \
    --entrypoint parallaxd "$NODE_IMAGE" "${node_flags[@]}" \
    --ws --ws.addr 0.0.0.0 --ws.origins '*' --ws.api eth,net,web3 \
    --mine --miner.threads 0 --miner.noverify --miner.coinbase "$POOL_ADDRESS" "${unlock[@]}" >/dev/null

docker run -d --name pp-e2e-node2 --network "$NET" -v pp-e2e-node2:/home/parallax/.parallax \
    --entrypoint parallaxd "$NODE_IMAGE" "${node_flags[@]}" >/dev/null

docker run -d --name pp-e2e-db --network "$NET" -e POSTGRES_USER=pool -e POSTGRES_PASSWORD=pool -e POSTGRES_DB=pool \
    "$DB_IMAGE" >/dev/null

pool_env=(-e POOL_ADDRESS="$POOL_ADDRESS" -e DB_HOST=pp-e2e-db -e DB_PASSWORD=pool
    -e NODE_HOST=pp-e2e-node1 -e NODE_WS_PORT=8546
    -e STRATUM_DIFFICULTY=0.00000005 -e VARDIFF_ENABLED=false -e PAYMENT_INTERVAL=20 -e BANNING_ENABLED=false)

if [ "$MODE" = pool ]; then
    pool_env+=(-e PAYOUT_MODE=pool -e PAYOUT_SCHEME=PPLNS -e POOL_FEE_PERCENT=1 -e MINIMUM_PAYMENT=0.5)
else
    pool_env+=(-e PAYOUT_MODE=direct)
fi

docker run -d --name pp-e2e-pool --network "$NET" -p "127.0.0.1:$API_PORT:4000" "${pool_env[@]}" "$POOL_IMAGE" >/dev/null

driver_env=(-e MODE="$MODE" -e POOL_ADDRESS="$POOL_ADDRESS" -e TIMEOUT="$TIMEOUT" -e THREADS_PER_MINER="$MINER_THREADS")

if [ "${DEV:-}" = 1 ]; then
    say "mining in the background (docker logs -f pp-e2e-driver)"
    docker run -d --name pp-e2e-driver --network "$NET" -v "$WORK:/e2e:ro" -e FOREVER=1 "${driver_env[@]}" \
        "$DRIVER_IMAGE" python -u /e2e/driver.py >/dev/null

    # Vite in a container too; ui/node_modules is shared with a host install (both glibc)
    ui=(--network "$NET" --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$REPO/ui:/ui" -w /ui "$UI_IMAGE")

    if [ ! -d "$REPO/ui/node_modules" ]; then
        say "installing the web UI's dependencies"
        docker run --rm "${ui[@]}" npm ci --no-audit --no-fund
    fi

    # detached and followed: Ctrl+C ends `docker logs` and the cleanup removes every container,
    # which works regardless of how Vite handles signals without a terminal
    docker run -d --name pp-e2e-ui -p "127.0.0.1:$UI_PORT:5173" -e POOL_API=http://pp-e2e-pool:4000 "${ui[@]}" \
        npx vite --host 0.0.0.0 --port 5173 --strictPort >/dev/null

    say "web UI with hot reload: http://127.0.0.1:$UI_PORT   (built-in UI: http://127.0.0.1:$API_PORT, Ctrl+C stops everything)"
    docker logs -f pp-e2e-ui
    exit 0
fi

say "mining (this takes a few minutes: blocks have to pass the 100-block lockbox)"
docker run --rm --network "$NET" -v "$WORK:/e2e:ro" "${driver_env[@]}" "$DRIVER_IMAGE" python -u /e2e/driver.py

# errors the pool logged along the way fail the test too
if docker logs pp-e2e-pool 2>&1 | grep -E '\[E\]|\[F\]'; then
    say "the pool logged errors"
    exit 1
fi

say "passed ($MODE mode)"
