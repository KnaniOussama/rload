#!/usr/bin/env bash
# Benchmark rload (Rust) vs node-load.js (Node) against the local test server.
# Usage: bench/run-bench.sh [concurrency] [requests] [port]
set -euo pipefail

CONC="${1:-100}"
REQS="${2:-50000}"
PORT="${3:-8080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://127.0.0.1:${PORT}/"

echo "Starting test server on port ${PORT}..."
node "${ROOT}/bench/server.js" "${PORT}" &
SERVER_PID=$!
trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT
sleep 1

echo
echo "=== Rust (rload) ==="
"${ROOT}/target/release/rload" "${URL}" -c "${CONC}" -n "${REQS}"

echo
echo "=== Node (node-load.js) ==="
node "${ROOT}/bench/node-load.js" "${URL}" -c "${CONC}" -n "${REQS}"
