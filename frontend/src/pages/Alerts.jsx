import React, { useState } from 'react';
import Loader from '../components/common/Loader';
import EmptyState from '../components/common/EmptyState';
import { usePolling } from '../hooks/usePolling';
import { getAlerts, ackAlert } from '../api/client';
import { formatSku, formatDate } from '../utils/format';

export default function Alerts() {
  const [showAll, setShowAll] = useState(false);
  const { data: alerts, loading, error, refetch } = usePolling(
    () => getAlerts(!showAll),
    5000
  );
  const [acking, setAcking] = useState(null);

  const handleAck = async (id) => {
    setAcking(id);
    try {
      await ackAlert(id);
      refetch();
    } catch (err) {
      alert(err.message);
    } finally {
      setAcking(null);
    }
  };

  if (loading) return <Loader text="Loading alerts…" />;
  if (error) return <EmptyState icon="⚠️" title="Backend unreachable" message={error} />;

  const activeCount = (alerts || []).filter((a) => !a.acked).length;

  return (
    <div>
      <div className="page-header">
        <h1>Alerts</h1>
        <p>{activeCount} active low-stock alert{activeCount !== 1 ? 's' : ''}</p>
      </div>

      <div className="filter-bar">
        <div className="filter-pills">
          <button
            className={`filter-pill${!showAll ? ' active' : ''}`}
            onClick={() => setShowAll(false)}
          >
            Active
          </button>
          <button
            className={`filter-pill${showAll ? ' active' : ''}`}
            onClick={() => setShowAll(true)}
          >
            All History
          </button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {!alerts || alerts.length === 0 ? (
          <EmptyState icon="✅" title="No alerts" message={showAll ? 'No alert history yet.' : 'All stock levels are healthy.'} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Count</th>
                <th>Threshold</th>
                <th>Needed</th>
                <th>Created</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {[...alerts].reverse().map((a) => (
                <tr key={a.id}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatSku(a.sku)}</td>
                  <td className="text-low">{a.count}</td>
                  <td>{a.threshold}</td>
                  <td>{a.needed}</td>
                  <td className="text-muted">{formatDate(a.createdAt)}</td>
                  <td>
                    {a.acked ? (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Acked {formatDate(a.ackedAt)}</span>
                    ) : (
                      <span className="text-low" style={{ fontSize: '0.72rem', fontWeight: 600 }}>ACTIVE</span>
                    )}
                  </td>
                  <td>
                    {!a.acked && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={acking === a.id}
                        onClick={() => handleAck(a.id)}
                      >
                        {acking === a.id ? '…' : 'Acknowledge'}
                      </button>
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
