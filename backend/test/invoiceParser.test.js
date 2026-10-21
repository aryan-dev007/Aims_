const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseInvoiceDetections, similarity } = require("../src/invoiceParser");

const products = [
  { sku: "Oreo biscuit" },
  { sku: "Cadbury chocolate" },
];
const detections = [
  [
    { text: "#", confidence: 0.99, box: [10, 10, 30, 30] },
    { text: "Product Name", confidence: 0.99, box: [80, 10, 220, 30] },
    { text: "Pack / Variant", confidence: 0.99, box: [230, 10, 340, 30] },
    { text: "Qty", confidence: 0.99, box: [350, 10, 380, 30] },
    { text: "Unit Price", confidence: 0.99, box: [390, 10, 470, 30] },
    { text: "Amount", confidence: 0.99, box: [480, 10, 550, 30] },
    { text: "SAMPLE INVOICE", confidence: 0.99, box: [430, 40, 600, 60] },
    { text: "Invoice No:", confidence: 0.99, box: [450, 70, 530, 90] },
    { text: "AIMS-TEST-001", confidence: 0.99, box: [530, 70, 630, 90] },
    { text: "Date:", confidence: 0.99, box: [480, 100, 520, 120] },
    { text: "21 Oct 2026", confidence: 0.99, box: [520, 100, 620, 120] },
    { text: "Oreo biscuit", confidence: 0.98, box: [130, 190, 220, 210] },
    { text: "Variant/weight: specify", confidence: 0.96, box: [230, 190, 345, 210] },
    { text: "12", confidence: 0.99, box: [350, 190, 380, 210] },
    { text: "25.50", confidence: 0.97, box: [410, 190, 450, 210] },
    { text: "306.00", confidence: 0.97, box: [500, 190, 550, 210] },
  ],
];

const parsed = parseInvoiceDetections(detections, products);
assert.strictEqual(parsed.invoiceNumber, "AIMS-TEST-001");
assert.strictEqual(parsed.items[0].description, "Oreo biscuit");
assert.strictEqual(parsed.items[0].qty, 12);
assert.strictEqual(parsed.items[0].unitPrice, 25.5);
assert.strictEqual(parsed.items[0].confidence, 0.96);
assert.strictEqual(parsed.items[0].sku, "Oreo biscuit");
assert.strictEqual(parsed.items[0].suggestedSku, "Oreo biscuit");
assert.strictEqual(parsed.items[0].matchScore, 1);
assert.strictEqual(parsed.invoiceNumber, "AIMS-TEST-001");
assert.strictEqual(parsed.invoiceDate, "2026-10-21");
assert(similarity("Oreo-biscuit", "Oreo biscuit") > 0.9);

const ambiguous = parseInvoiceDetections(
  [[
    { text: "#", confidence: 1, box: [10, 10, 30, 30] },
    { text: "Product Name", confidence: 1, box: [80, 10, 220, 30] },
    { text: "Pack / Variant", confidence: 1, box: [230, 10, 340, 30] },
    { text: "Qty", confidence: 1, box: [350, 10, 380, 30] },
    { text: "Unknown snack", confidence: 0.5, box: [130, 60, 220, 80] },
    { text: "Variant details", confidence: 0.5, box: [230, 60, 340, 80] },
    { text: "3", confidence: 0.5, box: [350, 60, 380, 80] },
  ]],
  products
);
assert.strictEqual(ambiguous.items[0].sku, "");
assert.strictEqual(ambiguous.items[0].qty, 3);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aims-invoice-"));
process.env.DATA_FILE = path.join(tempDir, "stock.json");
const stockService = require("../src/stockService");
const documentHash = "a".repeat(64);
const receipt = {
  invoiceNumber: "INV-TEST-1",
  documentHash,
  items: [{ sku: "Oreo biscuit", qty: 20, unitPrice: 2.5 }],
};
const created = stockService.createInvoice(receipt);
assert.strictEqual(created.applied["Oreo biscuit"], 20);
assert.strictEqual(stockService.productStatusList().find((p) => p.sku === "Oreo biscuit").count, 20);
assert.throws(
  () => stockService.createInvoice(receipt),
  (error) => error.code === "DUPLICATE_INVOICE"
);
assert.throws(
  () => stockService.createInvoice({ items: [{ sku: "Oreo biscuit", qty: 1.5 }] }),
  /positive integer/
);
assert.strictEqual(stockService.listInvoices().length, 1);
fs.rmSync(tempDir, { recursive: true, force: true });
console.log("Invoice parser tests passed.");
