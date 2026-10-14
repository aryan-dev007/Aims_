# Automated Stock Monitoring with YOLOv8

Vision-based inventory monitoring: detect and count grocery products from
camera feeds with a custom-trained YOLOv8 model, analyse stock against
thresholds, and feed a Node.js/n8n/Next.js automation pipeline.

## Dataset

`grocery.v9i.yolov8/` — Roboflow "grocery" dataset (62 SKU classes):

- train: 24,415 images
- valid: 4,081 images
- test: 6,884 images

## Project layout

| File | Purpose |
|------|---------|
| `data.yaml` | Dataset config with absolute paths (full data) |
| `grocery.v9i.yolov8/` | Full Roboflow dataset (24,415 train / 4,081 val / 6,884 test) |
| `make_subset.py` | Build a class-balanced CPU-friendly subset |
| `subset/` | Local training subset (used for the on-machine demo model) |
| `train.py` | Training script (CLI, tuned hyperparameters, resume support) |
| `predict.py` | Inference on image / folder / video / camera, prints stock counts |
| `monitor.py` | Real-time stock monitor: counts + low-stock alerts + backend ingest (ultralytics) |
| `opencv_detect.py` | OpenCV-native stock monitor: runs the YOLOv8 ONNX model via `cv2.dnn` (no ultralytics), counts + alerts + backend ingest. Live mode has a background frame grabber, HUD and throttled ingest |
| `make_demo_video.py` | Generate a synthetic shelf-scan video to exercise live mode without a camera |
| `export.py` | Export model to ONNX / OpenVINO / TensorRT |
| `colab_train.ipynb` | Full 25-epoch GPU training + test evaluation + download |
| `requirements.txt` | Python dependencies |
| `models/best.pt` | Active model used by every script (drop the Colab model here) |
| `backend/` | Node.js/Express REST API (stock ingest, alerts, reorder, n8n webhook) |
| `dashboard/` | Next.js + TypeScript + Tailwind real-time dashboard |
| `n8n/` | n8n automation workflow (replenishment order + approval) |
| `start_stack.sh` | Start backend + dashboard with one command (WSL/Linux) |

## Quick start

```bash
pip install -r requirements.txt

# Start the stack (backend + dashboard)
bash start_stack.sh

# Train on the local subset (CPU-friendly interim model)
python train.py --data subset/data.yaml --epochs 14 --imgsz 416 --batch 16 --device cpu --workers 8 --name stock_subset --cos_lr --patience 8
cp runs/detect/stock_subset/weights/best.pt models/best.pt

# Run inference
python predict.py --source <image_or_folder> --model models/best.pt --conf 0.3

# Real-time stock monitoring that POSTs detections to the backend
python monitor.py --source 0 --model models/best.pt --api http://localhost:4000 --imgsz 416

# Same, but running the ONNX model natively through OpenCV (cv2.dnn, no ultralytics)
python opencv_detect.py --source 0 --model models/best.onnx --api http://localhost:4000

# One-shot batch: analyse a folder of shelf images and push the aggregate to the backend
python opencv_detect.py --source grocery.v9i.yolov8/valid/images --api http://localhost:4000

# LIVE monitoring (webcam / video / IP camera), OpenCV-native with on-screen HUD:
python opencv_detect.py --source 0 --api http://localhost:4000                # webcam
python opencv_detect.py --source runs/demo_shelf.mp4 --loop --api http://localhost:4000
python opencv_detect.py --source rtsp://user:pass@192.168.1.20/stream --api http://localhost:4000
# Headless (no display), e.g. for a Raspberry Pi / server:
python opencv_detect.py --source 0 --no-display --api http://localhost:4000 --ingest-interval 5

# OpenCV inventory scans include every model class; products not seen in the
# current full-shelf view are saved as quantity 0. Point the camera at the
# entire shelf. Dataset-image fallback is opt-in so sample images cannot
# silently overwrite live inventory:
python opencv_detect.py --source 0 --api http://localhost:4000 --fallback-to-dataset

# Build a demo "shelf scan" video from the dataset to test live mode without a camera:
python make_demo_video.py --n 6 --out runs/demo_shelf.mp4

# Export for backend serving
python export.py --model models/best.pt --format onnx
```

Dashboard: http://localhost:3000 · Backend: http://localhost:4000

## Backend integration

### 1. Python side emits a JSON payload

`monitor.py` (ultralytics) or `opencv_detect.py` (OpenCV DNN) emits the payload
below. Use `--json stock.json` to write it to a file, or `--api
http://localhost:4000` to POST it straight to the backend:

```json
{
  "timestamp": "2026-08-13T18:30:00",
  "total_units": 214,
  "per_product": { "CocaCola20Oz": 4, "Oreo": 12 },
  "low_stock": { "CocaCola20Oz": { "count": 4, "threshold": 6, "needed": 2 } },
  "alerts": 1
}
```

### 2. Node.js backend ingests and persists it

```bash
cd backend
npm install
npm start        # http://localhost:4000
```

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/stock/ingest` | Accept `{ per_product, timestamp }`, update DB, open/close alerts |
| GET  | `/api/stock` | All SKUs with live counts, thresholds, status |
| GET  | `/api/stock/:sku` | Single product |
| GET  | `/api/pg/inventory` | Current quantities stored in PostgreSQL |
| GET  | `/api/pg/detection-logs?limit=10` | Recent PostgreSQL quantity changes |
| GET  | `/api/pg/health` | PostgreSQL connection status |
| GET  | `/api/alerts` | Low-stock alerts (`?active=false` for all) |
| POST | `/api/alerts/:id/ack` | Acknowledge an alert |
| GET  | `/api/reorder` | Procurement recommendation (`reorderQty = threshold*2 - count`) |
| POST | `/api/webhook/n8n` | Receive n8n automation events |
| GET  | `/api/snapshots` | History timeline for the dashboard |
| POST | `/api/orders` | Create procurement order (body `{ items?: [{sku, qty}], source? }`; without items it uses reorder recommendations) |
| GET  | `/api/orders` | List orders (`?status=pending` filters) |
| GET  | `/api/orders/:id` | Single order |
| POST | `/api/orders/:id/approve` | Approve an order (replenishment confirmation) |
| POST | `/api/orders/:id/cancel` | Cancel an order |

### 3. n8n consumes it

Point an n8n webhook node at `POST /api/webhook/n8n` and trigger the
replenishment/approval workflow whenever an alert is generated.

Import `n8n/low-stock-replenishment.workflow.json` into n8n and set the
`BACKEND_URL` environment variable (or n8n credential) to the backend base
URL. The workflow polls `/api/reorder` every 5 minutes and, when products are
low, creates a procurement order via `POST /api/orders` and builds an
approval message. Approve the order with `POST /api/orders/:id/approve`.

### 4. Dashboard

```bash
cd dashboard
npm install
npm run dev      # http://localhost:3000
```

The dashboard proxies `/api/*` to the backend (see `next.config.mjs`) so it works
without extra configuration. Override with `NEXT_PUBLIC_API_URL` if the backend
is elsewhere. The dashboard polls the backend every 5s: live stock table,
low-stock alerts with acknowledge, procurement recommendations, and summary stats.
The Inventory page shows detected products from PostgreSQL with their database
product ID, quantity, and last-detected timestamp; products with quantity 0 are
omitted from that view.

## Full training (recommended — GPU)

Full 24k-image training on this CPU is impractical (~12 hrs/epoch), so the
production model is trained on Google Colab with a T4 GPU:

1. Open `colab_train.ipynb` in Colab (Runtime -> Change runtime type -> T4 GPU).
2. Cell 0 creates `grocery.v9i.yolov8.zip` from this folder (or zip it yourself).
3. Upload the zip (or mount Drive), then run: 25 epochs → test evaluation → export ONNX → download `best.pt`.
4. Put it here: `cp ~/Downloads/best.pt models/best.pt`

Every script already points at `models/best.pt`, so the Colab model is a drop-in
upgrade over the interim CPU subset model.

## Tuning notes

- Full data: `imgsz=640`, `batch=16` on a T4 (or batch 64 with >16 GB VRAM).
- `optimizer=AdamW`, `lr0=0.001`, `cos_lr=True`, `close_mosaic=10`, patience 15.
- CPU subset run: `imgsz=416`, `batch=16`, 14 epochs (~5-6 h on 8 cores).
- Results live in `runs/detect/<name>/`.
