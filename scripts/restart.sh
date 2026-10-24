#!/bin/sh
# dev helper: restart the server in the background (mock mode by default); pid kept in data/server.pid
cd "$(dirname "$0")/.."
[ -f data/server.pid ] && kill "$(cat data/server.pid)" 2>/dev/null && sleep 1
MOCK=${MOCK:-1} nohup node --import tsx src/server.ts > "${LOG:-/tmp/roger-server.log}" 2>&1 &
echo $! > data/server.pid
sleep 3; curl -s "localhost:${PORT:-4000}/api/health"; echo
