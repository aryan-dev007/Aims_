const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const express = require("express");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aims-invoice-workflow-"));
process.env.DATA_FILE = path.join(tempDir, "stock.json");
process.env.OWNER_USERNAME = "invoice-owner";
process.env.OWNER_PASSWORD = "invoice-test-password";
process.env.JWT_SECRET = "invoice-test-signing-secret-at-least-32-bytes";

const detections = [
  [
    { text: "Item", confidence: 0.99, box: [10, 10, 60, 30] },
    { text: "Qty", confidence: 0.99, box: [180, 10, 210, 30] },
    { text: "Rate", confidence: 0.99, box: [250, 10, 290, 30] },
    { text: "Invoice No: INV-API-1", confidence: 0.99, box: [10, 40, 210, 60] },
    { text: "Oreo biscuit", confidence: 0.98, box: [10, 90, 120, 110] },
    { text: "20", confidence: 0.99, box: [180, 90, 210, 110] },
    { text: "3.25", confidence: 0.97, box: [250, 90, 290, 110] },
  ],
];

const ocrServer = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ pages: detections }));
  });
});

async function main() {
  await new Promise((resolve) => ocrServer.listen(0, "127.0.0.1", resolve));
  process.env.INVOICE_OCR_SERVER = `http://127.0.0.1:${ocrServer.address().port}`;

  const store = require("../src/store");
  const routes = require("../src/routes");
  store.upsertProduct("Oreo biscuit", { count: 50, threshold: 4 });

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api", routes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const document = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

  try {
    const unauthorized = await fetch(`${baseUrl}/invoices/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, mimeType: "image/png" }),
    });
    assert.strictEqual(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "invoice-owner", password: "invoice-test-password" }),
    });
    assert.strictEqual(login.status, 200);
    const { token } = await login.json();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const parse = await fetch(`${baseUrl}/invoices/parse`, {
      method: "POST",
      headers,
      body: JSON.stringify({ document, mimeType: "image/png" }),
    });
    assert.strictEqual(parse.status, 200);
    const extracted = await parse.json();
    assert.strictEqual(extracted.invoiceNumber, "INV-API-1");
    assert.strictEqual(extracted.items[0].sku, "Oreo biscuit");
    assert.strictEqual(extracted.items[0].qty, 20);

    const confirmBody = {
      invoiceNumber: extracted.invoiceNumber,
      documentHash: extracted.documentHash,
      items: [{
        sku: extracted.items[0].sku,
        qty: extracted.items[0].qty,
        unitPrice: extracted.items[0].unitPrice,
      }],
    };
    const confirm = await fetch(`${baseUrl}/invoices`, {
      method: "POST",
      headers,
      body: JSON.stringify(confirmBody),
    });
    assert.strictEqual(confirm.status, 201);
    assert.strictEqual((await confirm.json()).invoice.totalUnits, 20);

    const stockResponse = await fetch(`${baseUrl}/stock`);
    const stock = await stockResponse.json();
    assert.strictEqual(stock.find((product) => product.sku === "Oreo biscuit").count, 70);

    const duplicate = await fetch(`${baseUrl}/invoices`, {
      method: "POST",
      headers,
      body: JSON.stringify(confirmBody),
    });
    assert.strictEqual(duplicate.status, 409);
    assert.strictEqual(store.getInvoices().length, 1);
    assert.strictEqual(store.getProducts()["Oreo biscuit"].count, 70);
    console.log("Invoice upload-to-confirm workflow tests passed.");
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await new Promise((resolve, reject) =>
      ocrServer.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
