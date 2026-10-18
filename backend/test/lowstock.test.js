/**
 * Low-stock notification tests (no test framework required).
 *
 * Verifies the backend threshold-detection + duplicate-prevention logic and the
 * webhook push, using a temporary JSON store and a local HTTP receiver that
 * stands in for n8n. It does NOT (and cannot) verify real email delivery — that
 * depends on the n8n SMTP credential.
 *
 * Run:  npm run test:lowstock
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// --- Isolate state: temp data file + env BEFORE requiring app modules ---
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aims-lowstock-"));
process.env.DATA_FILE = path.join(tmpDir, "stock.json");
process.env.INVENTORY_OWNER_EMAIL = "owner@example.com";
process.env.ALERT_WEBHOOK_TOKEN = "test-token-123";

const PORT = 5899;
process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${PORT}/webhook/low-stock-alert`;

// Load .env for PostgreSQL credentials so product-ID enrichment is exercised.
// Values set above win because dotenv does not override existing variables.
require("dotenv").config();

const config = require("../src/config");
const svc = require("../src/stockService");
const store = require("../src/store");

const SKU = "Cadbury chocolate"; // exists in config thresholds (5) & PG seed
const THRESHOLD = config.thresholds[SKU];

let received = [];
let server;

function startReceiver() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          /* ignore */
        }
        received.push({ url: req.url, token: req.headers["x-aims-token"], body: parsed });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    server.listen(PORT, () => resolve());
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) return false;
    await sleep(50);
  }
  return true;
}

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function main() {
  await startReceiver();
  console.log(`\nLow-stock notification tests (threshold for "${SKU}" = ${THRESHOLD})\n`);

  // 1) Crossing below threshold opens an alert and pushes ONE webhook.
  const r1 = svc.ingest({ per_product: { [SKU]: THRESHOLD - 3 } });
  check("creates a new alert when stock < threshold", r1.newAlerts.length === 1);
  await waitFor(() => received.length >= 1);
  check("pushes exactly one webhook on first crossing", received.length === 1, `got ${received.length}`);

  const p = received[0]?.body;
  check("payload event = low_stock", p?.event === "low_stock");
  check("payload includes owner email", p?.ownerEmail === "owner@example.com");
  check("payload item has currentStock + minThreshold + timestamp",
    p?.items?.[0]?.currentStock !== undefined &&
    p?.items?.[0]?.minThreshold === THRESHOLD &&
    !!p?.items?.[0]?.timestamp);
  check("payload item has a productId field", p?.items?.[0] && "productId" in p.items[0]);
  check("auth header X-AIMS-Token sent", received[0]?.token === "test-token-123");

  // 2) Still low, another detection: no duplicate notification.
  svc.ingest({ per_product: { [SKU]: THRESHOLD - 4 } });
  await sleep(400);
  check("no duplicate webhook while stock stays low", received.length === 1, `got ${received.length}`);

  // 3) Recovered, then drops again: a fresh notification fires.
  svc.ingest({ per_product: { [SKU]: THRESHOLD + 20 } });
  await sleep(200);
  const r3 = svc.ingest({ per_product: { [SKU]: 0 } });
  check("re-opens an alert after recovery + drop", r3.newAlerts.length === 1);
  await waitFor(() => received.length >= 2);
  check("pushes again after restock + subsequent drop", received.length === 2, `got ${received.length}`);

  // 4) Notification state persisted on the alert.
  const latestAlert = store.getAlerts(true).find((a) => a.sku === SKU);
  check("alert records notified=true + notifiedAt", latestAlert?.notified === true && !!latestAlert?.notifiedAt);

  // 5) Webhook failure is handled gracefully (no throw), result reports failure.
  const notifier = require("../src/notifier");
  config.alertWebhookUrl = `http://127.0.0.1:5898/webhook/low-stock-alert`; // nothing listening
  const failRes = await notifier.notifyLowStock([
    { id: "x", sku: SKU, count: 0, threshold: THRESHOLD, createdAt: new Date().toISOString() },
  ]);
  check("unreachable webhook returns ok=false (no crash)", failRes.ok === false && !!failRes.error);
  config.alertWebhookUrl = `http://127.0.0.1:${PORT}/webhook/low-stock-alert`;

  // 6) No webhook URL configured -> skipped, not an error.
  const saved = config.alertWebhookUrl;
  config.alertWebhookUrl = "";
  const skipRes = await notifier.notifyLowStock([{ sku: SKU, count: 0, threshold: THRESHOLD }]);
  check("missing webhook URL is skipped (not failed)", skipRes.ok === false && !!skipRes.skipped);
  config.alertWebhookUrl = saved;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  server.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness error:", err);
  if (server) server.close();
  process.exit(1);
});
