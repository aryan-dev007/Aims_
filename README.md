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
| `n8n/` | n8n automation workflow (replenishment order + admin email alert) |
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
| POST | `/api/webhook/n8n` | Receive n8n automation events (optional `X-AIMS-Token`) |
| GET  | `/api/events?limit=100` | Automation / webhook / notification event log |
| GET  | `/api/snapshots` | History timeline for the dashboard |
| POST | `/api/orders` | Create procurement order (body `{ items?: [{sku, qty}], source? }`; without items it uses reorder recommendations) |
| GET  | `/api/orders` | List orders (`?status=pending` filters) |
| GET  | `/api/orders/:id` | Single order |
| POST | `/api/orders/:id/approve` | Approve an order (replenishment confirmation) |
| POST | `/api/orders/:id/cancel` | Cancel an order |
| POST | `/api/invoices` | Receive an invoice and add its quantities to stock (body `{ invoiceNumber?, supplier?, invoiceDate?, items: [{ sku, qty, unitPrice? }] }`) |
| GET  | `/api/invoices` | List received invoices (most recent first) |
| GET  | `/api/invoices/:id` | Single invoice |

### 3. n8n low-stock email alerts (end-to-end)

**How it works (event-driven, edge-triggered):**

```
YOLO detection / inventory update lowers a product's stock
  -> backend sees stock < that product's threshold (OK -> LOW)
  -> the exact instant a NEW alert opens, the backend POSTs a JSON event
     to the n8n Webhook node (ALERT_WEBHOOK_URL)
  -> n8n validates the request (shared token + payload)
  -> n8n sends an email to the inventory owner
```

One email per crossing event. Nothing is sent while a product simply stays low,
and a fresh email is sent again after the product is restocked and later drops
below the threshold again. Notifications are **not** sent on every database
check.

**What the backend sends (payload → n8n):**

```json
{
  "event": "low_stock",
  "source": "aims-backend",
  "generatedAt": "2026-08-13T18:30:00.000Z",
  "ownerEmail": "owner@example.com",
  "itemCount": 1,
  "subject": "Low stock alert: 1 product(s) below threshold",
  "message": "...human readable body...",
  "items": [
    {
      "productId": 6,
      "sku": "Soap bar",
      "productName": "Soap Bar",
      "currentStock": 0,
      "minThreshold": 4,
      "shortfall": 4,
      "reorderQty": 8,
      "timestamp": "2026-08-13T18:30:00.000Z"
    }
  ]
}
```

`productId`, `productName` and `currentStock` are read from the PostgreSQL
`products`/`inventory` tables when reachable; the JSON store values are used as
a fallback if PostgreSQL is down.

**Backend `.env` configuration** (see `backend/.env.example`):

| Variable | Purpose |
|---|---|
| `ALERT_WEBHOOK_URL` | n8n Webhook URL, e.g. `http://localhost:5678/webhook/low-stock-alert`. Blank disables the push. |
| `ALERT_WEBHOOK_TOKEN` | Shared secret sent as the `X-AIMS-Token` header. n8n validates it. |
| `ALERT_WEBHOOK_TIMEOUT_MS` | Webhook request timeout (default 8000). |
| `INVENTORY_OWNER_EMAIL` | Owner address included in the payload (alias `ADMIN_EMAIL`). |
| `N8N_INBOUND_TOKEN` | Optional; protects the inbound `POST /api/webhook/n8n` route. |

No URLs are hardcoded — everything comes from environment variables.

**Reliability & duplicate prevention.** Alerts are created only on an
OK→LOW transition (the existing alert store is the source of truth). The
notification outcome is persisted on the alert (`notified`, `notifyStatus`,
`notifiedAt`) and appended to the event log, so state survives restarts and is
auditable via `GET /api/events`. Webhook failures, timeouts, non-2xx responses
and unreachable hosts are caught and logged (without secrets) and never break
the detection pipeline — the next crossing still tries again.

**Security.** The webhook is protected by the `X-AIMS-Token` header (checked by
the workflow's IF node against the n8n env var `N8N_WEBHOOK_TOKEN`). Payloads are
validated (`event`, non-empty `items`) before an email is sent; invalid or
unauthorized requests get an HTTP 401 and no email. No secrets live in the
workflow JSON — email credentials are attached in n8n's credential manager.

#### Setup steps

1. **Run n8n locally (Docker):**

   ```bash
   docker run -it --rm --name n8n -p 5678:5678 \
     -e N8N_WEBHOOK_TOKEN=<same value as ALERT_WEBHOOK_TOKEN> \
     -e INVENTORY_OWNER_EMAIL=owner@example.com \
     -e ALERT_FROM_EMAIL=alerts@example.com \
     -e BACKEND_URL=http://host.docker.internal:4000 \
     -v n8n_data:/home/node/.n8n \
     docker.n8n.io/n8nio/n8n
   ```

   > On Linux, replace `host.docker.internal` with your host IP, or add
   > `--add-host=host.docker.internal:host-gateway`.

2. **Configure Gmail / SMTP in n8n** (Credentials → New → *SMTP*):
   - Gmail requires an **App Password** (Google Account → Security →
   2-Step Verification → App passwords). Your normal password will not work.
   - Host `smtp.gmail.com`, port `465` (SSL) or `587` (STARTTLS), user = your
   Gmail address, password = the App Password.
   - Port `25` is usually blocked and will time out — prefer 465/587.
   - Credentials are stored encrypted by n8n; they are never in this repo.

3. **Import the workflow:** open http://localhost:5678 → Workflows → Import from
   File → `n8n/low-stock-replenishment.workflow.json`.

4. **Attach credentials:** open the `Email owner (low stock)` node and select
   your SMTP credential.

5. **Activate** the workflow (top-right toggle). The production webhook URL is
   shown on the `Webhook (low stock)` node and must match `ALERT_WEBHOOK_URL`.

6. **Copy backend `.env`:** `cp backend/.env.example backend/.env` and fill in
   real values (PostgreSQL password, a strong `ALERT_WEBHOOK_TOKEN`, owner
   email). Generate a token with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

7. **Restart the backend** so it picks up the new environment variables.

#### Testing

The workflow also has a scheduled part (every 5 min) that polls `/api/reorder`
and creates a procurement order when products are low — independent of the email
path.

**Backend-only test (no n8n):** run the repeatable suite:

```bash
cd backend && npm run test:lowstock
```

It spins up a local webhook receiver, drives the detection/threshold logic and
asserts: one webhook per crossing, no duplicates while low, re-notify after a
restock + drop, persisted notification state, and graceful handling of an
unreachable webhook.

**Full test with a product below threshold:**

```bash
# 1. create an alert for a SKU that is currently OK (so it crosses below)
curl -X POST http://localhost:4000/api/stock/ingest \
  -H "Content-Type: application/json" \
  -d '{"per_product":{"Soap bar":0}}'

# 2. inspect the outcome
curl http://localhost:4000/api/events?limit=5      # low_stock_notify entry
curl "http://localhost:4000/api/alerts?active=false" | grep -o '"notifyStatus":"[^"]*"'
```

**Distinguishing the two success stages:**

| Stage | Where to verify |
|---|---|
| **Webhook accepted by n8n** | Backend log line `[notify] low-stock event accepted by n8n (HTTP 200)` and `notifyStatus: "sent"` on the alert. |
| **Email actually delivered** | n8n → **Executions**: open the run and check the `Email owner` node succeeded. A positive `notifyStatus: "sent"` only means n8n accepted the event — **it does not prove an email was sent** unless the SMTP credential is valid and the n8n execution shows success. |

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
