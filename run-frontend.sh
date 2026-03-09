#!/usr/bin/env bash
set -euo pipefail

PORT="${FRONTEND_PORT:-3002}"

echo "==> Killing any process on port $PORT..."
lsof -ti :"$PORT" | xargs kill -9 2>/dev/null && echo "    Killed." || echo "    No process found."

echo "==> Starting frontend on port $PORT..."
cd "$(dirname "$0")/frontend"
exec npx next dev -p "$PORT"
