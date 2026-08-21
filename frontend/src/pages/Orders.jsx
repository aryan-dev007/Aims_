import React, { useState } from 'react';
import Loader from '../components/common/Loader';
import EmptyState from '../components/common/EmptyState';
import { usePolling } from '../hooks/usePolling';
import { getOrders, createOrder, approveOrder, cancelOrder } from '../api/client';
import { formatSku, formatDate } from '../utils/format';

const STATUS_COLORS = {
  pending: 'var(--color-pending)',
  approved: 'var(--color-approved)',
  cancelled: 'var(--color-cancelled)',
};

export default function Orders() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: orders, loading, error, refetch } = usePolling(
    () => getOrders(statusFilter || undefined),
    5000
  );
  const [busy, setBusy] = useState(null);

  const handleCreate = async () => {
    setBusy('create');
    try {
      await createOrder({ source: 'dashboard' });
      refetch();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async (id) => {
    setBusy(id);
    try {
      await approveOrder(id);
      refetch();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async (id) => {
    setBusy(id);
    try {
      await cancelOrder(id);
      refetch();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loader text="Loading orders…" />;
  if (error) return <EmptyState icon="⚠️" title="Backend unreachable" message={error} />;

  return (
    <div>
      <div className="page-header">
        <h1>Orders</h1>
        <p>Procurement orders for low-stock replenishment</p>
      </div>

      <div className="filter-bar">
        <div className="filter-pills">
          {['', 'pending', 'approved', 'cancelled'].map((s) => (
            <button
              key={s || 'all'}
              className={`filter-pill${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy === 'create'} onClick={handleCreate}>
          {busy === 'create' ? 'Creating…' : '+ Create from Reorder'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {!orders || orders.length === 0 ? (
          <EmptyState icon="📋" title="No orders" message="Create an order from reorder recommendations." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Items</th>
                <th>Total Units</th>
                <th>Source</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...orders].reverse().map((o) => (
                <tr key={o.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {o.id.slice(0, 8)}…
                  </td>
                  <td>
                    <div style={{ maxWidth: 280 }}>
                      {o.items.slice(0, 3).map((i) => (
                        <div key={i.sku} style={{ fontSize: '0.82rem' }}>
                          {formatSku(i.sku)} × {i.qty}
                        </div>
                      ))}
                      {o.items.length > 3 && (
                        <div className="text-muted" style={{ fontSize: '0.75rem' }}>+{o.items.length - 3} more</div>
                      )}
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{o.totalUnits}</td>
                  <td className="text-muted">{o.source}</td>
                  <td>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase',
                      color: STATUS_COLORS[o.status] || 'var(--text-muted)',
                    }}>
                      {o.status}
                    </span>
                  </td>
                  <td className="text-muted">{formatDate(o.createdAt)}</td>
                  <td>
                    {o.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busy === o.id}
                          onClick={() => handleApprove(o.id)}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={busy === o.id}
                          onClick={() => handleCancel(o.id)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
