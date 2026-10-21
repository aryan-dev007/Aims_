/**
 * Centralized API client for all backend communication.
 * The dev server or Docker reverse proxy forwards same-origin API requests.
 */

const BASE = '';  // proxy handles it

async function request(endpoint, options = {}) {
  const url = `${BASE}${endpoint}`;
  const token = sessionStorage.getItem('ownerToken');
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const config = {
    ...options,
    headers,
  };

  const res = await fetch(url, config);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export const loginOwner = (username, password) =>
  request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }).then((result) => {
    sessionStorage.setItem('ownerToken', result.token);
    return result;
  });

// ---- Stock ----
export const getStock = () => request('/api/stock');
export const getStockSku = (sku) => request(`/api/stock/${sku}`);

// ---- Running scan totals ----
export const getTotals = () => request('/api/stock/totals');
export const resetTotals = () =>
  request('/api/stock/totals/reset', { method: 'POST' });
export const adjustTotal = (sku, delta) =>
  request('/api/stock/totals/adjust', {
    method: 'POST',
    body: JSON.stringify({ sku, delta }),
  });

// ---- Alerts ----
export const getAlerts = (activeOnly = true) =>
  request(`/api/alerts${activeOnly ? '' : '?active=false'}`);
export const ackAlert = (id) =>
  request(`/api/alerts/${id}/ack`, { method: 'POST' });

// ---- Reorder ----
export const getReorder = () => request('/api/reorder');

// ---- Orders ----
export const getOrders = (status) =>
  request(`/api/orders${status ? `?status=${status}` : ''}`);
export const createOrder = (body = {}) =>
  request('/api/orders', { method: 'POST', body: JSON.stringify(body) });
export const approveOrder = (id, approvedBy = 'dashboard-user') =>
  request(`/api/orders/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ approvedBy }),
  });
export const cancelOrder = (id) =>
  request(`/api/orders/${id}/cancel`, { method: 'POST' });

// ---- Invoices (goods received → add stock) ----
export const getInvoices = () => request('/api/invoices');
export const getInvoice = (id) => request(`/api/invoices/${id}`);
export const createInvoice = (body = {}) =>
  request('/api/invoices', { method: 'POST', body: JSON.stringify(body) });
export const parseInvoiceDocument = (body) =>
  request('/api/invoices/parse', { method: 'POST', body: JSON.stringify(body) });

// ---- Snapshots ----
export const getSnapshots = (limit = 100) =>
  request(`/api/snapshots?limit=${limit}`);

// ---- Events ----
export const getEvents = (limit = 50) =>
  request(`/api/events?limit=${limit}`);

// ---- Health ----
export const getHealth = () => request('/api/health');

// ---- Predict Image / Camera Snapshot ----
// accumulate=true adds the detected counts to the running scan total.
export const predictImage = (image, conf = 0.45, accumulate = false) =>
  request('/api/predict', {
    method: 'POST',
    body: JSON.stringify({ image, conf, accumulate }),
  });

// ---- PostgreSQL Inventory ----
export const getPgInventory = () => request('/api/pg/inventory');
export const getPgProductInventory = (className) =>
  request(`/api/pg/inventory/${encodeURIComponent(className)}`);
export const getPgDetectionLogs = (limit = 50) =>
  request(`/api/pg/detection-logs?limit=${limit}`);
export const getPgHealth = () => request('/api/pg/health');
