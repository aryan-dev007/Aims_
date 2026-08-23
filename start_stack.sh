#!/usr/bin/env bash
# Start the full monitoring stack (WSL / Linux):
#   predict_server (Python) -> http://localhost:5555
#   backend (Express)       -> http://localhost:4000
#   frontend (Vite)         -> http://localhost:5173
# Usage: bash start_stack.sh [--monitor SOURCE]
set -euo pipefail
cd "$(dirname "$0")"

NODE="${NODE:-$(command -v node || echo "$HOME/.local/bin/node")}"
PYTHON="${PYTHON:-$(command -v python3 || command -v python || echo "python")}"
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

start predict_server "$PYTHON -u predict_server.py --port 5555" "predict_server.py"
echo "Waiting for YOLO model to load..."
sleep 6

start backend  "cd backend && $NODE src/server.js" "src/server.js"
start frontend "cd frontend && npm run dev" "vite"

echo "Predict Server: http://localhost:5555"
echo "Backend:        http://localhost:4000  (health: curl localhost:4000/api/health)"
echo "Frontend:       http://localhost:5173"

if [[ "${1:-}" == "--monitor" ]]; then
  shift
  echo "Starting OpenCV monitor on ${1:-0} ..."
  if [[ "${1:-}" == -* ]]; then
    # Flags only (e.g. --monitor --no-display --conf 0.2)
    exec "$PYTHON" -u opencv_detect.py --api http://localhost:4000 "$@"
  else
    # Bare source (e.g. --monitor 0, --monitor runs/demo_shelf.mp4)
    source_arg="${1:-0}"
    shift 2>/dev/null || true
    exec "$PYTHON" -u opencv_detect.py --api http://localhost:4000 --source "$source_arg" "$@"
  fi
fi
