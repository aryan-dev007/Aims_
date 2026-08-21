#!/usr/bin/env bash
# Start the full monitoring stack (WSL / Linux):
#   backend (Express)  -> http://localhost:4000
#   dashboard (Next.js) -> http://localhost:3000
# Usage: bash start_stack.sh [--monitor SOURCE]
set -euo pipefail
cd "$(dirname "$0")"

NODE="${NODE:-$(command -v node || echo "$HOME/.local/bin/node")}"
mkdir -p runs

start() {
  local name="$1" cmd="$2"
  if pgrep -f "$3" > /dev/null 2>&1; then
    echo "[skip] $name already running"
  else
    echo "[start] $name"
    setsid bash -c "$cmd" < /dev/null > "runs/$name.log" 2>&1 &
    sleep 2
  fi
}

# Build the dashboard once if the production build is missing (fresh clone).
if [[ ! -d "dashboard/.next/server" ]]; then
  echo "[build] dashboard (first run)"
  ( cd dashboard && PATH="$(dirname "$NODE"):$PATH" "$NODE" node_modules/next/dist/bin/next build )
fi

start backend  "cd backend && $NODE src/server.js" "src/server.js"
start dashboard "cd dashboard && $NODE node_modules/next/dist/bin/next start -p 3000" "next-server"

echo "Backend:   http://localhost:4000  (health: curl localhost:4000/api/health)"
echo "Dashboard: http://localhost:3000"

if [[ "${1:-}" == "--monitor" ]]; then
  shift
  echo "Starting OpenCV monitor on ${1:-0} ..."
  if [[ "${1:-}" == -* ]]; then
    # Flags only (e.g. --monitor --no-display --conf 0.2)
    exec python3 -u opencv_detect.py --api http://localhost:4000 "$@"
  else
    # Bare source (e.g. --monitor 0, --monitor runs/demo_shelf.mp4)
    source_arg="${1:-0}"
    shift 2>/dev/null || true
    exec python3 -u opencv_detect.py --api http://localhost:4000 --source "$source_arg" "$@"
  fi
fi
