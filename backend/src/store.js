const fs = require("fs");
const path = require("path");
const config = require("./config");

class JsonStore {
  constructor(file = config.dataFile) {
    this.file = file;
    this.data = this._load();
  }

  _load() {
    const defaults = { products: {}, alerts: [], snapshots: [], events: [], orders: [], totals: {}, invoices: [] };
    try {
      return { ...defaults, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    } catch {
      return defaults;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  // ---- products ----
  getProducts() {
    return this.data.products;
  }

  upsertProduct(sku, patch) {
    this.data.products[sku] = { ...this.data.products[sku], ...patch };
    this.save();
    return this.data.products[sku];
  }

  // ---- running totals (only ever increase until explicitly reset) ----
  getTotals() {
    if (!this.data.totals) this.data.totals = {};
    return this.data.totals;
  }

  addTotals(perProduct) {
    const totals = this.getTotals();
    for (const [sku, qty] of Object.entries(perProduct || {})) {
      const n = Math.floor(Number(qty));
      if (!Number.isFinite(n) || n <= 0) continue;
      totals[sku] = (totals[sku] || 0) + n;
    }
    this.save();
    return totals;
  }

  resetTotals() {
    this.data.totals = {};
    this.save();
    return this.data.totals;
  }

  adjustTotal(sku, delta) {
    const totals = this.getTotals();
    const next = Math.max(0, (totals[sku] || 0) + Math.floor(Number(delta) || 0));
    if (next === 0) delete totals[sku];
    else totals[sku] = next;
    this.save();
    return totals[sku] || 0;
  }

  // ---- live stock (goods received via invoices) ----
  // Increases a product's on-hand count. Unknown SKUs are created on the fly
  // using the configured threshold (or 0). Returns the updated product.
  incrementCount(sku, qty) {
    const delta = Math.floor(Number(qty));
    if (!Number.isFinite(delta) || delta <= 0) return this.data.products[sku] || null;
    const patch = this.data.products[sku] || {};
    const threshold = patch.threshold ?? config.thresholds[sku] ?? 0;
    this.data.products[sku] = {
      ...patch,
      count: (patch.count || 0) + delta,
      threshold,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.data.products[sku];
  }

  // ---- alerts ----
  getAlerts(activeOnly = false) {
    const alerts = this.data.alerts;
    return activeOnly ? alerts.filter((a) => !a.acked) : alerts;
  }

  addAlert(alert) {
    this.data.alerts.push(alert);
    this.save();
    return alert;
  }

  updateAlert(id, patch) {
    const alert = this.data.alerts.find((a) => a.id === id);
    if (!alert) return null;
    Object.assign(alert, patch);
    this.save();
    return alert;
  }

  ackAlert(id) {
    const alert = this.data.alerts.find((a) => a.id === id);
    if (!alert) return null;
    alert.acked = true;
    alert.ackedAt = new Date().toISOString();
    this.save();
    return alert;
  }

  // ---- snapshots (history) ----
  pushSnapshot(entry) {
    this.data.snapshots.push(entry);
    if (this.data.snapshots.length > 1000) {
      this.data.snapshots = this.data.snapshots.slice(-1000);
    }
    this.save();
  }

  getSnapshots(limit = 100) {
    return this.data.snapshots.slice(-limit);
  }

  // ---- events (automation / webhook log) ----
  pushEvent(entry) {
    this.data.events.push(entry);
    if (this.data.events.length > 500) {
      this.data.events = this.data.events.slice(-500);
    }
    this.save();
  }

  getEvents(limit = 100) {
    return this.data.events.slice(-limit);
  }

  // ---- orders (procurement) ----
  getOrders() {
    return this.data.orders;
  }

  addOrder(order) {
    this.data.orders.push(order);
    this.save();
    return order;
  }

  updateOrder(id, patch) {
    const order = this.data.orders.find((o) => o.id === id);
    if (!order) return null;
    Object.assign(order, patch);
    this.save();
    return order;
  }

  // ---- invoices (goods received / stock-in) ----
  getInvoices() {
    if (!this.data.invoices) this.data.invoices = [];
    return this.data.invoices;
  }

  addInvoice(invoice) {
    if (!this.data.invoices) this.data.invoices = [];
    this.data.invoices.push(invoice);
    this.save();
    return invoice;
  }

  getInvoice(id) {
    return this.getInvoices().find((i) => i.id === id) || null;
  }
}

module.exports = new JsonStore();
