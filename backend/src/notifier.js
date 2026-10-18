const config = require("./config");

/**
 * Low-stock notification push (backend -> n8n webhook).
 *
 * Triggered ONLY when a new alert opens, i.e. the instant a product crosses
 * below its configured minimum threshold (edge trigger). It never runs while a
 * product simply stays low, so the owner receives a single notification per
 * crossing event and a fresh one after a restock + subsequent drop.
 *
 * The payload is enriched from the existing PostgreSQL `products`/`inventory`
 * tables (real product ID, display name, current stock) when the database is
 * reachable, and falls back to the JSON store values otherwise.
 */
const OWNER_EMAIL = () => config.inventoryOwnerEmail || "";

/**
 * Resolve product identity (id, display name, current stock) from PostgreSQL.
 * Best-effort: returns an empty Map if PostgreSQL is unavailable or slow.
 */
async function resolveProducts(classNames) {
  try {
    const pgInventory = require("./pgInventory");
    return await pgInventory.getProductsByClassNames(classNames);
  } catch (err) {
    console.warn("[notify] product lookup skipped:", err.message);
    return new Map();
  }
}

/**
 * Build the low-stock event payload sent to n8n.
 *
 * Every item includes: product ID, product name, current stock, minimum
 * threshold, shortfall, recommended reorder quantity and a timestamp. The
 * owner email is included both per-item and at the top level.
 */
async function buildEmailPayload(newAlerts) {
  const now = new Date().toISOString();
  const ownerEmail = OWNER_EMAIL();
  const lookup = await resolveProducts(newAlerts.map((a) => a.sku));

  const items = newAlerts.map((a) => {
    const db = lookup.get(a.sku) || {};
    const minThreshold =
      a.threshold ?? config.thresholds[a.sku] ?? db.minThreshold ?? 0;
    const currentStock = a.count ?? 0;
    const shortfall = Math.max(minThreshold - currentStock, 0);
    const reorderQty = Math.max(
      minThreshold * config.reorderBuffer - currentStock,
      0
    );
    return {
      productId: db.product_id ?? null,
      sku: a.sku,
      productName: db.product_name || a.sku,
      currentStock,
      minThreshold,
      shortfall,
      reorderQty,
      timestamp: a.createdAt || now,
      // Backwards-compatible aliases used by earlier workflow versions.
      product: db.product_name || a.sku,
      count: currentStock,
      threshold: minThreshold,
      needed: shortfall,
    };
  });

  const lines = items.map(
    (i) =>
      `- ${i.productName} (ID ${i.productId ?? "n/a"}): stock ${i.currentStock}, ` +
      `minimum ${i.minThreshold} -> restock at least ${i.reorderQty} unit(s)`
  );

  const subject =
    `Low stock alert: ${items.length} product(s) below threshold`;
  const message = [
    "Automated Inventory Management System (AIMS) - low stock detected.",
    "",
    ...lines,
    "",
    "Recommendation: restock the item(s) above to resume safe stock levels.",
    `Total products below threshold: ${items.length}`,
    `Time: ${now}`,
  ].join("\n");

  return {
    event: "low_stock",
    source: "aims-backend",
    generatedAt: now,
    ownerEmail,
    itemCount: items.length,
    items,
    alerts: items,
    subject,
    message,
  };
}

/**
 * Push the payload to the configured n8n webhook.
 *
 * Fire-and-forget by design: never throws, so a missing/unreachable n8n or a
 * network error can never break the detection pipeline. Returns a structured
 * result so the caller can persist notification state and log diagnostics.
 *
 * NOTE: a successful webhook request only means n8n ACCEPTED the event. It does
 * NOT prove the email was delivered - that depends on the n8n SMTP/Gmail
 * credential and is visible in the n8n execution log.
 */
async function notifyLowStock(newAlerts) {
  if (!Array.isArray(newAlerts) || newAlerts.length === 0) {
    return { ok: false, skipped: "no new alerts" };
  }

  const payload = await buildEmailPayload(newAlerts);
  const url = config.alertWebhookUrl;

  if (!url) {
    console.log(
      "[notify] ALERT_WEBHOOK_URL not set - low-stock push disabled."
    );
    return { ok: false, skipped: "no webhook url", payload };
  }

  const headers = { "Content-Type": "application/json" };
  if (config.alertWebhookToken) headers["X-AIMS-Token"] = config.alertWebhookToken;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.alertWebhookTimeoutMs),
    });

    if (!res.ok) {
      // Read a short diagnostic body without dumping sensitive data.
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      console.warn(
        `[notify] webhook rejected the event (HTTP ${res.status}). ${detail}`
      );
      return {
        ok: false,
        status: res.status,
        error: `webhook responded ${res.status}`,
        payload,
      };
    }

    console.log(
      `[notify] low-stock event accepted by n8n (HTTP ${res.status}) for ` +
        `${payload.itemCount} product(s)`
    );
    return { ok: true, status: res.status, payload };
  } catch (err) {
    console.warn("[notify] webhook push failed:", err.message);
    return { ok: false, error: err.message, payload };
  }
}

module.exports = { notifyLowStock, buildEmailPayload };
