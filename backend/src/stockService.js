const crypto = require("crypto");
const store = require("./store");
const config = require("./config");
const notifier = require("./notifier");

function thresholdFor(sku) {
  return config.thresholds[sku] ?? 0;
}

function sanitizeCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Merge a payload produced by monitor.py:
 *   { timestamp, total_units, per_product: {SKU: count}, low_stock, alerts }
 * Updates persisted counts, evaluates thresholds, opens/keeps alerts and
 * records a history snapshot. Returns the resulting alert state.
 */
function ingest(payload) {
  const { per_product = {}, timestamp } = payload;
  const now = timestamp || new Date().toISOString();
  const alerts = [];
  const open = [];

  for (const [sku, rawCount] of Object.entries(per_product)) {
    const count = sanitizeCount(rawCount);
    if (count === null) continue; // ignore malformed entries

    const threshold = thresholdFor(sku);
    store.upsertProduct(sku, { count, threshold, updatedAt: now });

    const status = count < threshold ? "LOW" : "OK";
    const openAlerts = store.getAlerts(true).filter((a) => a.sku === sku);

    if (status === "LOW") {
      const needed = threshold - count;
      if (openAlerts.length === 0) {
        const alert = store.addAlert({
          id: crypto.randomUUID(),
          sku,
          count,
          threshold,
          needed,
          createdAt: now,
          acked: false,
        });
        alerts.push(alert);
      } else {
        // Keep existing alerts current (persisted via store.updateAlert)
        for (const existing of openAlerts) {
          store.updateAlert(existing.id, { count, needed });
          open.push(existing);
        }
      }
    } else {
      // Stock recovered -> close every open alert for this SKU
      for (const openAlert of openAlerts) store.ackAlert(openAlert.id);
    }
  }

  const active = store.getAlerts(true);
  store.pushSnapshot({ timestamp: now, per_product, activeAlerts: active.length });

  // Edge-triggered notification: only when a product JUST crossed below its
  // threshold (a new alert opened). Stays quiet while a product remains low.
  // Notification state is persisted on the alert and in the event log so it is
  // auditable and survives restarts. Never blocks or throws.
  if (alerts.length > 0) {
    notifier
      .notifyLowStock(alerts)
      .then((res) => {
        const at = new Date().toISOString();
        const status = res.ok
          ? "sent"
          : res.skipped
          ? `skipped:${res.skipped}`
          : `failed:${res.error || "unknown"}`;
        for (const alert of alerts) {
          store.updateAlert(alert.id, {
            notified: !!res.ok,
            notifyStatus: status,
            notifiedAt: at,
          });
        }
        store.pushEvent({
          type: "low_stock_notify",
          at,
          itemCount: alerts.length,
          skus: alerts.map((a) => a.sku),
          ok: !!res.ok,
          status,
          httpStatus: res.status ?? null,
        });
      })
      .catch((err) => console.warn("[notify]", err.message));
  }

  return { newAlerts: alerts, openAlerts: open, activeAlerts: active };
}

/**
 * Generate procurement recommendations for every low-stock product:
 *   reorderQty = max(threshold * reorderBuffer - count, 0)
 */
function generateReorder() {
  const products = store.getProducts();
  return Object.entries(products)
    .map(([sku, p]) => ({
      sku,
      count: p.count,
      threshold: p.threshold,
      reorderQty: Math.max(p.threshold * config.reorderBuffer - p.count, 0),
      status: p.count < p.threshold ? "LOW" : "OK",
    }))
    .filter((p) => p.status === "LOW")
    .sort((a, b) => b.reorderQty - a.reorderQty);
}

function productStatusList() {
  const products = store.getProducts();
  const totals = store.getTotals();
  const skus = new Set([...Object.keys(products), ...Object.keys(totals)]);
  return [...skus].map((sku) => {
    const p = products[sku] || {};
    const count = p.count ?? 0;
    const threshold = p.threshold ?? thresholdFor(sku);
    return {
      sku,
      count,
      total: totals[sku] || 0,
      threshold,
      status: count < threshold ? "LOW" : "OK",
      updatedAt: p.updatedAt || null,
    };
  });
}

/**
 * Add a scan's detected counts to the running total for each SKU. Totals only
 * ever increase (until reset), so the chart reflects a cumulative tally rather
 * than the number of items currently visible in the frame.
 */
function accumulate(perProduct = {}) {
  const clean = {};
  for (const [sku, rawCount] of Object.entries(perProduct)) {
    const count = sanitizeCount(rawCount);
    if (count === null || count === 0) continue;
    clean[sku] = count;
  }
  const totals = store.addTotals(clean);
  return { added: clean, totals };
}

function resetTotals() {
  return store.resetTotals();
}

function adjustTotal(sku, delta) {
  if (typeof sku !== "string" || !sku.trim()) {
    throw new Error("sku is required");
  }
  const d = Math.floor(Number(delta));
  if (!Number.isFinite(d) || d === 0) {
    throw new Error("delta must be a non-zero integer");
  }
  return store.adjustTotal(sku.trim(), d);
}

function totalsList() {
  const totals = store.getTotals();
  return Object.entries(totals).map(([sku, total]) => ({ sku, total }));
}

/**
 * Record a received invoice (goods received) and add its quantities to stock.
 * Each line item bumps the product's on-hand count and the cumulative total,
 * then any low-stock alerts for that SKU are re-evaluated.
 *
 * Body: { invoiceNumber?, supplier?, invoiceDate?, receivedBy?, items: [{sku, qty, unitPrice?}] }
 */
function createInvoice({ invoiceNumber, supplier, invoiceDate, receivedBy, documentHash, items } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  const normalizedInvoiceNumber =
    typeof invoiceNumber === "string" ? invoiceNumber.trim() : "";
  const normalizedDocumentHash =
    typeof documentHash === "string" && /^[a-f0-9]{64}$/i.test(documentHash)
      ? documentHash.toLowerCase()
      : null;
  if (documentHash && !normalizedDocumentHash) {
    throw new Error("documentHash must be a valid SHA-256 hash");
  }

  const duplicate = store.getInvoices().find((existing) =>
    (normalizedDocumentHash && existing.documentHash === normalizedDocumentHash) ||
    (normalizedInvoiceNumber &&
      typeof existing.invoiceNumber === "string" &&
      existing.invoiceNumber.toLowerCase() === normalizedInvoiceNumber.toLowerCase())
  );
  if (duplicate) {
    const error = new Error("This invoice has already been recorded.");
    error.code = "DUPLICATE_INVOICE";
    throw error;
  }

  const clean = [];
  for (const item of items) {
    if (!item || typeof item.sku !== "string" || !item.sku.trim()) {
      throw new Error("Every invoice item must have a matched product");
    }
    const qty = Number(item.qty);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new Error(`Quantity for ${item.sku} must be a positive integer`);
    }
    const price = item.unitPrice === "" || item.unitPrice == null ? 0 : Number(item.unitPrice);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Unit price for ${item.sku} must be a non-negative number`);
    }
    const unitPrice = price;
    clean.push({
      sku: item.sku.trim(),
      name: item.name || null,
      qty,
      unitPrice,
      lineTotal: Number((qty * unitPrice).toFixed(2)),
    });
  }
  if (clean.length === 0) throw new Error("no valid invoice items");

  const now = new Date().toISOString();

  const invoice = {
    id: crypto.randomUUID(),
    invoiceNumber: normalizedInvoiceNumber || null,
    documentHash: normalizedDocumentHash,
    supplier: (supplier || "").trim() || null,
    invoiceDate: typeof invoiceDate === "string" && invoiceDate ? invoiceDate : null,
    items: clean,
    totalUnits: clean.reduce((s, i) => s + i.qty, 0),
    totalAmount: Number(clean.reduce((s, i) => s + i.lineTotal, 0).toFixed(2)),
    status: "received",
    receivedBy: receivedBy || "admin",
    createdAt: now,
  };

  const applied = store.commitInvoice(invoice, config.thresholds);
  return { invoice, applied };
}

function listInvoices() {
  return [...store.getInvoices()].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

function getInvoice(id) {
  return store.getInvoice(id);
}

/**
 * Create a procurement order from either explicit items [{sku, qty}] or the
 * current reorder recommendations. Returns the persisted order.
 */
function createOrder({ items, source = "manual" } = {}) {
  const orderItems = items
    ? items
        .filter((i) => i && typeof i.sku === "string" && i.sku.trim())
        .map((i) => ({
          sku: i.sku,
          qty: Math.max(0, Math.floor(Number(i.qty) || 0)),
        }))
        .filter((i) => i.qty > 0)
    : generateReorder().map((i) => ({ sku: i.sku, qty: i.reorderQty }));

  const order = {
    id: crypto.randomUUID(),
    items: orderItems,
    totalUnits: orderItems.reduce((s, i) => s + i.qty, 0),
    status: "pending",
    source,
    createdAt: new Date().toISOString(),
  };
  return store.addOrder(order);
}

module.exports = {
  ingest,
  generateReorder,
  productStatusList,
  createOrder,
  accumulate,
  resetTotals,
  adjustTotal,
  totalsList,
  createInvoice,
  listInvoices,
  getInvoice,
};
