import React, { useState } from 'react';
import StatusBadge from '../components/common/StatusBadge';
import Loader from '../components/common/Loader';
import EmptyState from '../components/common/EmptyState';
import KpiCard from '../components/common/KpiCard';
import { usePolling } from '../hooks/usePolling';
import { getReorder, createOrder } from '../api/client';
import { formatSku } from '../utils/format';

export default function Reorder() {
  const { data: reorder, loading, error, refetch } = usePolling(getReorder, 5000);
  const [busy, setBusy] = useState(false);

  const handleCreateOrder = async () => {
    setBusy(true);
    try {
      await createOrder({ source: 'reorder-page' });
      alert('Order created successfully!');
      refetch();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loader text="Loading reorder recommendations…" />;
  if (error) return <EmptyState icon="⚠️" title="Backend unreachable" message={error} />;

  const items = reorder?.items || [];
  const totalUnits = reorder?.totalUnits || 0;

  return (
    <div>
      <div className="page-header">
        <h1>Reorder</h1>
        <p>Procurement recommendations for low-stock products</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        <KpiCard icon="🛒" label="Items to Reorder" value={items.length} accent="warning" />
        <KpiCard icon="📦" label="Total Units Needed" value={totalUnits.toLocaleString()} accent="low" />
        <KpiCard icon="🕐" label="Generated" value={reorder?.generatedAt ? new Date(reorder.generatedAt).toLocaleTimeString() : '—'} accent="info" />
      </div>

      <div className="filter-bar">
        <button
          className="btn btn-primary"
          disabled={busy || items.length === 0}
          onClick={handleCreateOrder}
        >
          {busy ? 'Creating order…' : 'Create Procurement Order'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {items.length === 0 ? (
          <EmptyState icon="✅" title="No reorders needed" message="All products are above their thresholds." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Current Count</th>
                <th>Threshold</th>
                <th>Reorder Qty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.sku}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatSku(item.sku)}</td>
                  <td className="text-low">{item.count}</td>
                  <td>{item.threshold}</td>
                  <td style={{ fontWeight: 700, color: 'var(--color-warning)' }}>{item.reorderQty}</td>
                  <td><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
