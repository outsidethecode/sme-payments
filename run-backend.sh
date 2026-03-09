#!/usr/bin/env bash
set -euo pipefail

PORT="${BACKEND_PORT:-3001}"

echo "==> Killing any process on port $PORT..."
lsof -ti :"$PORT" | xargs kill -9 2>/dev/null && echo "    Killed." || echo "    No process found."

echo "==> Starting backend on port $PORT..."
cd "$(dirname "$0")/backend"
exec npm run dev
