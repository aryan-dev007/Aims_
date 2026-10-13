/**
 * Centralized API client for all backend communication.
 * Vite dev server proxies /api/* to http://localhost:4000
 */

const BASE = '';  // proxy handles it

async function request(endpoint, options = {}) {
  const url = `${BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  const res = await fetch(url, config);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- Stock ----
export const getStock = () => request('/api/stock');
export const getStockSku = (sku) => request(`/api/stock/${sku}`);

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

// ---- Snapshots ----
export const getSnapshots = (limit = 100) =>
  request(`/api/snapshots?limit=${limit}`);

// ---- Events ----
export const getEvents = (limit = 50) =>
  request(`/api/events?limit=${limit}`);

// ---- Health ----
export const getHealth = () => request('/api/health');

// ---- Predict Image / Camera Snapshot ----
export const predictImage = (image, conf = 0.45) =>
  request('/api/predict', {
    method: 'POST',
    body: JSON.stringify({ image, conf }),
  });

// ---- PostgreSQL Inventory ----
export const getPgInventory = () => request('/api/pg/inventory');
export const getPgProductInventory = (className) =>
  request(`/api/pg/inventory/${encodeURIComponent(className)}`);
export const getPgDetectionLogs = (limit = 50) =>
  request(`/api/pg/detection-logs?limit=${limit}`);
export const getPgHealth = () => request('/api/pg/health');
