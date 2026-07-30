#!/usr/bin/env bash
# Run the integration suite against a throwaway server instance.
#
#   bun run test:server
#
# Starts the proxy on TEST_PORT (default 8099), seeds the tokens the suite expects,
# runs tests/server.test.ts, then shuts the server down. Without this the suite
# fails with 404/403 — it needs a live, seeded server.
set -uo pipefail

PORT="${TEST_PORT:-8099}"
ADMIN_KEY="${ADMIN_KEY:-malikkurosaki}"
LOG="$(mktemp -t claude-proxy-test-server)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT already in use — set TEST_PORT to a free port" >&2
  exit 1
fi

ADMIN_KEY="$ADMIN_KEY" bun src/serve.ts --port "$PORT" > "$LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/v1/models" && break
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited during startup:" >&2; tail -20 "$LOG" >&2; exit 1
  fi
  sleep 0.5
done

# Seed the tokens the suite asserts on. Must be form-encoded — the admin handler
# reads a form body and silently ignores JSON.
for t in sk-user-bagas sk-user-nico sk-user-amel; do
  curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/admin/token/add" \
    -H "x-admin-key: $ADMIN_KEY" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode "token=$t" --data-urlencode "limit=60000"
done

TEST_URL="http://127.0.0.1:$PORT" ADMIN_KEY="$ADMIN_KEY" bun test tests/server.test.ts
