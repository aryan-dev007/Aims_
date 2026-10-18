const path = require("path");

module.exports = {
  port: process.env.PORT || 4000,
  // Where detected counts are persisted (JSON file store).
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "stock.json"),
  // Reorder buffer multiplier: reorderQty = max(threshold*2 - count, 0)
  reorderBuffer: 2,

  // ---- n8n low-stock email integration ----

  // Webhook URL the backend POSTs a low-stock event to the moment a product
  // drops below its threshold. Configurable; empty = notification push disabled.
  alertWebhookUrl:
    process.env.ALERT_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || "",

  // Shared secret sent as the `X-AIMS-Token` header so the n8n webhook can
  // reject unauthorized requests. Empty = no auth header sent.
  alertWebhookToken: process.env.ALERT_WEBHOOK_TOKEN || "",

  // Per-request timeout for the webhook push (ms).
  alertWebhookTimeoutMs: parseInt(process.env.ALERT_WEBHOOK_TIMEOUT_MS, 10) || 8000,

  // Inventory owner who receives low-stock emails. Included in the payload so
  // n8n does not need the address hardcoded. `ADMIN_EMAIL` kept as an alias.
  inventoryOwnerEmail:
    process.env.INVENTORY_OWNER_EMAIL || process.env.ADMIN_EMAIL || "",

  // Optional: require this token on the inbound `POST /api/webhook/n8n` route.
  // Empty = the route stays open (backwards compatible).
  inboundWebhookToken:
    process.env.N8N_INBOUND_TOKEN || process.env.ALERT_WEBHOOK_TOKEN || "",
  // Per-SKU low-stock thresholds. Unknown SKUs default to 0 (never alert).
  thresholds: {
    "Coca cola cold drink": 5,
    "Oreo biscuit": 4,
    "Lipton tea": 3,
    "Lays masala chips": 4,
    "Fanta cold drink": 5,
    "Soap bar": 4,
    "Colgate Paste": 4,
    "Britannia biscuits": 4,
    "Cadbury chocolate": 5,
    "Nescafe coffee": 3,
    "RedLabel Tea": 3,
    "Maggi Noodles": 4,
    "Chings Schezwan Chutney": 3,
    "Amul Item": 4,
    "TajMahal tea": 3,
    "DrOetker": 3,
    "Real juice": 4,
    "Bru coffee": 3,
    "Parle biscuit": 4,
    "Veeba sauce": 3,
  },
};
