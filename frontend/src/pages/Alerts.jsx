import React, { useMemo, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { getAlerts, ackAlert } from '../api/client';
import { formatSku, formatDate } from '../utils/format';

export default function Alerts() {
  const [showAll, setShowAll] = useState(false);
  const { data: allAlerts, loading, error, refetch } = usePolling(
    () => getAlerts(false),
    5000
  );
  const [working, setWorking] = useState(null);
  const [actionError, setActionError] = useState('');

  const activeCount = useMemo(
    () => (allAlerts || []).filter((a) => !a.acked).length,
    [allAlerts]
  );

  const rows = useMemo(() => {
    const list = allAlerts || [];
    const filtered = showAll ? list : list.filter((a) => !a.acked);
    return [...filtered].reverse();
  }, [allAlerts, showAll]);

  const onAck = async (id) => {
    setWorking(id);
    setActionError('');
    try {
      await ackAlert(id);
      await refetch();
    } catch (err) {
      setActionError(err.message || 'Failed to acknowledge alert');
    } finally {
      setWorking(null);
    }
  };

  return (
    <main style={{ display: 'block' }}>
      <div className="page-status-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <span className="summary-pill">
            {activeCount} active alert{activeCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="toggle-group">
          <button
            className={`nav-link${!showAll ? ' active' : ''}`}
            onClick={() => setShowAll(false)}
          >
            Active
          </button>
          <button
            className={`nav-link${showAll ? ' active' : ''}`}
            onClick={() => setShowAll(true)}
          >
            All
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Low-stock alerts</div>

        {actionError && <p className="note note-error">{actionError}</p>}
        {error && <p className="note note-error">{error}</p>}

        {loading ? (
          <div className="chart-empty">Loading alerts…</div>
        ) : rows.length === 0 ? (
          <div className="chart-empty">
            {showAll ? 'No alerts recorded yet.' : 'No active low-stock alerts. All good!'}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Count</th>
                <th>Threshold</th>
                <th>Needed</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="cell-strong">{formatSku(a.sku)}</td>
                  <td className="cell-low">{a.count}</td>
                  <td>{a.threshold}</td>
                  <td>{a.needed}</td>
                  <td>
                    {a.acked ? (
                      <span className="pill pill-ok">Resolved</span>
                    ) : (
                      <span className="pill pill-low">Low</span>
                    )}
                  </td>
                  <td className="cell-muted">{formatDate(a.createdAt)}</td>
                  <td>
                    {!a.acked && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => onAck(a.id)}
                        disabled={working === a.id}
                      >
                        {working === a.id ? 'Acknowledging…' : 'Acknowledge'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
