const express = require("express");
const store = require("./store");
const svc = require("./stockService");

const router = express.Router();

// Health
router.get("/health", (req, res) => {
  const detectorOnline = req.app.get("detectorStatus")();
  res.json({ status: "ok", uptime: process.uptime(), detectorOnline });
});

// Ingest a monitor.py JSON payload: { per_product: {...}, timestamp }
router.post("/stock/ingest", (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object" || !payload.per_product) {
    return res.status(400).json({ error: "Expected body: { per_product: {SKU: count}, timestamp? }" });
  }

  // Mark detector as active
  req.app.get("detectorPing")();

  const result = svc.ingest(payload);

  // Broadcast real-time update via Socket.IO
  const io = req.app.get("io");
  if (io) {
    io.emit("stock:update", {
      timestamp: payload.timestamp || new Date().toISOString(),
      per_product: payload.per_product,
      total_units: payload.total_units,
      low_stock: payload.low_stock,
      alerts: result.activeAlerts.length,
      products: svc.productStatusList(),
    });
  }

  res.json(result);
});

// All products with live counts, thresholds and status
router.get("/stock", (req, res) => {
  res.json(svc.productStatusList());
});

// Single product
router.get("/stock/:sku", (req, res) => {
  const product = store.getProducts()[req.params.sku];
  if (!product) return res.status(404).json({ error: "SKU not found" });
  res.json({ sku: req.params.sku, ...product });
});

// Active / all alerts
router.get("/alerts", (req, res) => {
  const activeOnly = req.query.active !== "false";
  res.json(store.getAlerts(activeOnly));
});

// Acknowledge an alert
router.post("/alerts/:id/ack", (req, res) => {
  const alert = store.ackAlert(req.params.id);
  if (!alert) return res.status(404).json({ error: "Alert not found" });

  // Broadcast alert acknowledged
  const io = req.app.get("io");
  if (io) {
    io.emit("alert:acked", alert);
  }

  res.json(alert);
});

// Procurement recommendations (used by n8n / dashboard)
router.get("/reorder", (req, res) => {
  const items = svc.generateReorder();
  res.json({
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    totalUnits: items.reduce((s, i) => s + i.reorderQty, 0),
    items,
  });
});

// n8n webhook target: receives automation events (e.g. order placed) and logs
// them to the event log (kept separate from the stock history timeline).
router.post("/webhook/n8n", (req, res) => {
  const event = { ...req.body, receivedAt: new Date().toISOString() };
  store.pushEvent({ ...event, note: "n8n-webhook" });
  res.json({ ok: true, event });
});

// Automation / webhook event log
router.get("/events", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json(store.getEvents(limit));
});

// History snapshots for the dashboard timeline
router.get("/snapshots", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json(store.getSnapshots(limit));
});

// ---- Annotated frame from OpenCV detector ----
// Body: { frame: "<base64-jpeg>", timestamp, fps, counts, low_stock }
router.post("/frame", (req, res) => {
  const { frame, timestamp, fps, counts, low_stock } = req.body;
  if (!frame) {
    return res.status(400).json({ error: "Expected body: { frame: '<base64-jpeg>' }" });
  }

  // Mark detector as active
  req.app.get("detectorPing")();

  // Broadcast frame to all connected dashboard clients
  const io = req.app.get("io");
  if (io) {
    io.emit("frame:update", {
      frame,
      timestamp: timestamp || new Date().toISOString(),
      fps: fps || 0,
      counts: counts || {},
      low_stock: low_stock || {},
    });
  }

  res.json({ ok: true });
});

// ---- Direct Image / Webcam Prediction Endpoint ----
// Proxies to the persistent predict_server.py (port 5555) for fast
// inference (~200ms vs 3-5s when spawning a new process each time).
// Falls back to the old execFile approach if the server is unreachable.
const http = require("http");
const { execFile } = require("child_process");
const path = require("path");

const PREDICT_SERVER = process.env.PREDICT_SERVER || "http://127.0.0.1:5555";

function proxyToServer(image, conf) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ image, conf });
    const url = new URL("/predict", PREDICT_SERVER);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 15000,
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          reject(new Error("Bad JSON from predict server"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Predict server timeout")); });
    req.write(payload);
    req.end();
  });
}

function fallbackExecFile(image, conf) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, "../../predict_frame.py");
    const pyProcess = execFile("python", [scriptPath, "--conf", String(conf)], {
      maxBuffer: 15 * 1024 * 1024,
      cwd: path.resolve(__dirname, "../.."),
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error("Invalid prediction response")); }
    });
    pyProcess.stdin.write(image);
    pyProcess.stdin.end();
  });
}

router.post("/predict", async (req, res) => {
  const { image, conf = 0.30 } = req.body || {};
  if (!image) {
    return res.status(400).json({ error: "Image data (base64 or path) required" });
  }

  try {
    // Try the fast persistent server first, fall back to process spawn
    let result;
    try {
      result = await proxyToServer(image, conf);
    } catch {
      console.log("[PREDICT] Predict server unavailable, falling back to execFile…");
      result = await fallbackExecFile(image, conf);
    }

    // Ingest detections + broadcast via Socket.IO
    if (result.ok && result.per_product) {
      req.app.get("detectorPing")();
      const ingestResult = svc.ingest(result);
      const io = req.app.get("io");
      if (io) {
        io.emit("stock:update", {
          timestamp: result.timestamp || new Date().toISOString(),
          per_product: result.per_product,
          total_units: result.total_units,
          low_stock: result.low_stock,
          alerts: ingestResult.activeAlerts.length,
          products: svc.productStatusList(),
        });
        if (result.annotatedFrame) {
          const rawFrameB64 = result.annotatedFrame.includes(",")
            ? result.annotatedFrame.split(",")[1]
            : result.annotatedFrame;
          io.emit("frame:update", {
            frame: rawFrameB64,
            timestamp: result.timestamp,
            fps: result.inference_ms ? Math.round(1000 / result.inference_ms) : 2,
            counts: result.per_product,
            low_stock: result.low_stock,
          });
        }
      }
    }
    res.json(result);
  } catch (err) {
    console.error("[PREDICT ERROR]", err);
    res.status(500).json({ error: "Prediction failed", details: err.message });
  }
});

// ---- Detector status ----
router.get("/detector/status", (req, res) => {
  const online = req.app.get("detectorStatus")();
  res.json({ online });
});

// ---- Procurement orders ----

// Create an order. Body: { items?: [{sku, qty}], source?: string }
// Without items, one is generated from current reorder recommendations.
router.post("/orders", (req, res) => {
  const { items, source } = req.body || {};
  if (items && (!Array.isArray(items) || items.length === 0)) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }
  const order = svc.createOrder({ items, source });
  if (order.items.length === 0) {
    return res.status(400).json({ error: "no valid order items" });
  }
  res.status(201).json(order);
});

// List orders (?status=pending filters)
router.get("/orders", (req, res) => {
  const { status } = req.query;
  let orders = store.getOrders();
  if (status) orders = orders.filter((o) => o.status === status);
  res.json(orders);
});

// Single order
router.get("/orders/:id", (req, res) => {
  const order = store.getOrders().find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// Approve an order (replenishment confirmation)
router.post("/orders/:id/approve", (req, res) => {
  const { approvedBy } = req.body || {};
  const order = store.updateOrder(req.params.id, {
    status: "approved",
    approvedBy: approvedBy || "system",
    approvedAt: new Date().toISOString(),
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// Cancel an order
router.post("/orders/:id/cancel", (req, res) => {
  const order = store.updateOrder(req.params.id, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

module.exports = router;
