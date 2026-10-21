const express = require("express");
const store = require("./store");
const svc = require("./stockService");
const config = require("./config");
const auth = require("./auth");
const crypto = require("crypto");
const { parseInvoiceDetections } = require("./invoiceParser");

const router = express.Router();

async function persistDetections(req, perProduct) {
  const pgInv = req.app.get("pgInventory");
  if (!pgInv) {
    const error = new Error("PostgreSQL inventory service is unavailable");
    error.code = "PG_INVENTORY_UPDATE";
    throw error;
  }

  try {
    const result = await pgInv.upsertDetection(perProduct);
    if (result.changed.length > 0) {
      const io = req.app.get("io");
      if (io) {
        io.emit("pg:inventory:update", {
          snapshot: result.snapshot,
          changed: result.changed,
          timestamp: new Date().toISOString(),
        });
      }
    }
    return result;
  } catch (cause) {
    const error = new Error(`PostgreSQL inventory update failed: ${cause.message}`);
    error.code = "PG_INVENTORY_UPDATE";
    throw error;
  }
}

// Health
router.get("/health", (req, res) => {
  const detectorOnline = req.app.get("detectorStatus")();
  res.json({ status: "ok", uptime: process.uptime(), detectorOnline });
});

// Owner sign-in for manual inventory operations.
router.post("/auth/login", (req, res) => {
  if (!auth.isConfigured()) {
    return res.status(503).json({
      error: "Owner authentication is not configured. Set OWNER_USERNAME, OWNER_PASSWORD, and a JWT_SECRET of at least 32 characters.",
    });
  }
  const { username, password } = req.body || {};
  if (!auth.verifyOwnerCredentials(username, password)) {
    return res.status(401).json({ error: "Invalid owner username or password" });
  }

  res.json({
    token: auth.createOwnerToken(),
    tokenType: "Bearer",
    expiresIn: auth.TOKEN_LIFETIME_SECONDS,
  });
});

// Ingest a monitor.py JSON payload: { per_product: {...}, timestamp }
router.post("/stock/ingest", async (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object" || !payload.per_product) {
    return res.status(400).json({ error: "Expected body: { per_product: {SKU: count}, timestamp? }" });
  }

  let postgres;
  try {
    postgres = await persistDetections(req, payload.per_product);
  } catch (err) {
    console.error("[PG] Ingest error:", err.message);
    return res.status(503).json({ error: err.message });
  }

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

  res.json({
    ...result,
    postgres: { changed: postgres.changed, unknown: postgres.unknown },
  });
});

// All products with live counts, thresholds and status
router.get("/stock", (req, res) => {
  res.json(svc.productStatusList());
});

// Running scan totals (cumulative, only go up until reset)
router.get("/stock/totals", (req, res) => {
  res.json(svc.totalsList());
});

// Reset all running scan totals
router.post("/stock/totals/reset", auth.requireOwner, (req, res) => {
  const totals = svc.resetTotals();

  const io = req.app.get("io");
  if (io) {
    io.emit("stock:update", {
      timestamp: new Date().toISOString(),
      per_product: {},
      total_units: 0,
      low_stock: {},
      alerts: store.getAlerts(true).length,
      products: svc.productStatusList(),
    });
  }

  res.json({ ok: true, totals });
});

// Manually adjust a product's running total. Body: { sku, delta } (delta +1/-1)
router.post("/stock/totals/adjust", auth.requireOwner, (req, res) => {
  const { sku, delta } = req.body || {};
  let total;
  try {
    total = svc.adjustTotal(sku, delta);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const io = req.app.get("io");
  if (io) {
    io.emit("stock:update", {
      timestamp: new Date().toISOString(),
      per_product: {},
      total_units: 0,
      low_stock: {},
      alerts: store.getAlerts(true).length,
      products: svc.productStatusList(),
    });
  }

  res.json({ ok: true, sku, total });
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
// Protected by an optional shared token (config.inboundWebhookToken):
//   header  X-AIMS-Token: <token>   or   ?token=<token>
router.post("/webhook/n8n", (req, res) => {
  const expected = config.inboundWebhookToken;
  if (expected) {
    const provided =
      req.get("x-aims-token") || req.query.token || "";
    if (provided !== expected) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "Expected a JSON object body" });
  }

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
    const pyBin = process.env.PYTHON_BIN || "python";
    const pyProcess = execFile(pyBin, [scriptPath, "--conf", String(conf)], {
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
  const { image, conf = 0.45, accumulate = false } = req.body || {};
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
      let ingestResult;
      if (accumulate) {
        // Running-total mode: bump live counts AND add to the cumulative total.
        // Does not require PostgreSQL so it works even if PG is offline.
        ingestResult = svc.ingest(result);
        result.total = svc.accumulate(result.per_product);
      } else {
        const postgres = await persistDetections(req, result.per_product);
        ingestResult = svc.ingest(result);
        result.postgres = { changed: postgres.changed, unknown: postgres.unknown };
      }

      req.app.get("detectorPing")();
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
    if (err.code === "PG_INVENTORY_UPDATE") {
      return res.status(503).json({ error: err.message });
    }
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

// ======================================================================
// Invoices — goods received that add stock
// ======================================================================

const OCR_SERVER = process.env.INVOICE_OCR_SERVER || "http://127.0.0.1:5556";
const MAX_INVOICE_BYTES = 8 * 1024 * 1024;

router.post("/invoices/parse", auth.requireOwner, async (req, res) => {
  const { document, mimeType } = req.body || {};
  if (
    typeof document !== "string" ||
    !["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(mimeType)
  ) {
    return res.status(400).json({ error: "Upload a PDF, PNG, or JPEG invoice." });
  }
  if (document.length > Math.ceil(MAX_INVOICE_BYTES * 4 / 3) + 4) {
    return res.status(413).json({ error: "Invoice files must be no larger than 8 MB." });
  }

  let fileBytes;
  try {
    fileBytes = Buffer.from(document, "base64");
  } catch {
    return res.status(400).json({ error: "The uploaded document is not valid base64 data." });
  }
  if (fileBytes.length === 0 || fileBytes.length > MAX_INVOICE_BYTES) {
    return res.status(413).json({ error: "Invoice files must be no larger than 8 MB." });
  }
  if (fileBytes.toString("base64").replace(/=+$/, "") !== document.replace(/=+$/, "")) {
    return res.status(400).json({ error: "The uploaded document is not valid base64 data." });
  }

  const validSignature =
    (mimeType === "application/pdf" && fileBytes.subarray(0, 5).toString() === "%PDF-") ||
    (mimeType === "image/png" && fileBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    ((mimeType === "image/jpeg" || mimeType === "image/jpg") &&
      fileBytes[0] === 0xff && fileBytes[1] === 0xd8 && fileBytes[2] === 0xff);
  if (!validSignature) {
    return res.status(400).json({ error: "The file contents do not match the selected PDF, PNG, or JPEG format." });
  }

  try {
    const ocrResponse = await fetch(`${OCR_SERVER}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, mimeType }),
      signal: AbortSignal.timeout(120000),
    });
    const ocrResult = await ocrResponse.json().catch(() => ({}));
    if (!ocrResponse.ok) {
      return res.status(ocrResponse.status === 400 ? 400 : 502).json({
        error: ocrResult.error || "Invoice OCR service could not process this document.",
      });
    }

    const parsed = parseInvoiceDetections(ocrResult.pages, svc.productStatusList());
    if (!parsed.items.length) {
      return res.status(422).json({
        error: "No invoice line items could be identified. Use manual entry or upload a clearer invoice.",
      });
    }
    res.json({
      ...parsed,
      documentHash: crypto.createHash("sha256").update(fileBytes).digest("hex"),
    });
  } catch (err) {
    console.error("[INVOICE OCR]", err.message);
    res.status(503).json({
      error: "Invoice OCR service is unavailable. Start the PaddleOCR service and try again.",
    });
  }
});

// Create a received invoice and add its quantities to stock.
// Body: { invoiceNumber?, supplier?, invoiceDate?, receivedBy?, items: [{ sku, qty, unitPrice? }] }
router.post("/invoices", auth.requireOwner, async (req, res) => {
  let result;
  try {
    result = svc.createInvoice(req.body || {});
  } catch (err) {
    if (err.code === "DUPLICATE_INVOICE") {
      return res.status(409).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message });
  }

  const { invoice, applied } = result;

  // Mirror the stock-in to PostgreSQL (best-effort — never blocks the response).
  let postgres = null;
  const pgInv = req.app.get("pgInventory");
  if (pgInv) {
    try {
      postgres = await pgInv.receiveStock(
        invoice.items.map((i) => ({ sku: i.sku, qty: i.qty }))
      );
    } catch (err) {
      postgres = { error: err.message };
      console.warn("[PG] Invoice stock-in failed:", err.message);
    }
  }

  const io = req.app.get("io");
  if (io) {
    io.emit("stock:update", {
      timestamp: new Date().toISOString(),
      per_product: applied,
      total_units: invoice.totalUnits,
      low_stock: {},
      alerts: store.getAlerts(true).length,
      products: svc.productStatusList(),
    });
    io.emit("invoice:created", invoice);
  }

  res.status(201).json({ invoice, applied, postgres });
});

// List invoices (most recent first)
router.get("/invoices", (req, res) => {
  res.json(svc.listInvoices());
});

// Single invoice
router.get("/invoices/:id", (req, res) => {
  const invoice = svc.getInvoice(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

// ======================================================================
// PostgreSQL-backed inventory endpoints
// ======================================================================

// Full inventory from PostgreSQL
router.get("/pg/inventory", async (req, res) => {
  try {
    const pgInv = req.app.get("pgInventory");
    const snapshot = await pgInv.getInventorySnapshot();
    res.json(snapshot);
  } catch (err) {
    console.error("[PG API] /pg/inventory error:", err.message);
    res.status(500).json({ error: "Database query failed" });
  }
});

// Single product inventory from PostgreSQL
router.get("/pg/inventory/:className", async (req, res) => {
  try {
    const pgInv = req.app.get("pgInventory");
    const product = await pgInv.getProductInventory(req.params.className);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    console.error("[PG API] /pg/inventory/:className error:", err.message);
    res.status(500).json({ error: "Database query failed" });
  }
});

// Detection history from PostgreSQL
router.get("/pg/detection-logs", async (req, res) => {
  try {
    const pgInv = req.app.get("pgInventory");
    const limit = parseInt(req.query.limit, 10) || 100;
    const logs = await pgInv.getDetectionLogs(limit);
    res.json(logs);
  } catch (err) {
    console.error("[PG API] /pg/detection-logs error:", err.message);
    res.status(500).json({ error: "Database query failed" });
  }
});

// PostgreSQL health check
router.get("/pg/health", async (req, res) => {
  try {
    const { testConnection } = require("./db");
    const ok = await testConnection();
    res.json({ postgresql: ok ? "connected" : "disconnected" });
  } catch (err) {
    res.json({ postgresql: "error", message: err.message });
  }
});

module.exports = router;
