const crypto = require("crypto");
const store = require("./store");
const config = require("./config");

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
  return Object.entries(store.getProducts()).map(([sku, p]) => ({
    sku,
    count: p.count,
    threshold: p.threshold,
    status: p.count < p.threshold ? "LOW" : "OK",
    updatedAt: p.updatedAt,
  }));
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

module.exports = { ingest, generateReorder, productStatusList, createOrder };
