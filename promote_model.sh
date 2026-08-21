#!/usr/bin/env bash
# Copy the latest trained weights into models/best.pt (used by every script).
set -e
cd "$(dirname "$0")"
SRC="${1:-runs/detect/runs/detect/stock_subset/weights/best.pt}"
if [[ -f "$SRC" ]]; then
  mkdir -p models
  cp "$SRC" models/best.pt
  echo "Promoted $SRC -> models/best.pt"
else
  echo "No weights found at $SRC" >&2
  exit 1
fi
