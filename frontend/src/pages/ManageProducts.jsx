import React, { useCallback, useState } from 'react';
import { useStockTotals } from '../hooks/useStockTotals';
import TotalsChart from '../components/TotalsChart';
import ConnectionStatus from '../components/ConnectionStatus';

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function ManageProducts() {
  const {
    chartData,
    manageData,
    totalUnits,
    connected,
    detectorOnline,
    adjust,
    reset,
  } = useStockTotals();

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const onAdjust = useCallback(
    async (sku, delta) => {
      setError('');
      setMessage('');
      try {
        await adjust(sku, delta);
        setMessage(delta < 0 ? `Decreased ${sku}` : `Increased ${sku}`);
      } catch (err) {
        setError(err.message || 'Failed to update product');
      }
    },
    [adjust]
  );

  const onReset = useCallback(async () => {
    setError('');
    setMessage('');
    try {
      await reset();
      setMessage('All totals cleared');
    } catch (err) {
      setError(err.message || 'Failed to reset totals');
    }
  }, [reset]);

  return (
    <>
      <div className="page-status-row">
        <ConnectionStatus connected={connected} detectorOnline={detectorOnline} />
      </div>

      <main className="app-main">
        <section className="card">
          <div className="card-head">
            <div className="card-title" style={{ marginBottom: 0 }}>
              Manage products
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onReset}>
              Reset all
            </button>
          </div>

          {error && <p className="note note-error">{error}</p>}
          {!error && message && <p className="note note-ok">{message}</p>}

          {manageData.length === 0 ? (
            <div className="chart-empty">
              No products yet — scan something on the Scanner page.
            </div>
          ) : (
            <ul className="manage-list">
              {manageData.map((p) => (
                <li key={p.sku}>
                  <span className="avatar">{initials(p.name)}</span>
                  <span className="manage-name">{p.name}</span>
                  <div className="stepper">
                    <button
                      className="step-btn minus"
                      title="Decrease by 1"
                      onClick={() => onAdjust(p.sku, -1)}
                    >
                      −
                    </button>
                    <span className="manage-count">{p.total}</span>
                    <button
                      className="step-btn plus"
                      title="Increase by 1"
                      onClick={() => onAdjust(p.sku, 1)}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="side">
          <div className="card total-card">
            <div className="total-label">Total scanned</div>
            <div className="total-value">{totalUnits}</div>
            <div className="total-sub">
              {chartData.length} product{chartData.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Products</div>
            <TotalsChart data={chartData} emptyText="No products to manage yet." />
          </div>
        </section>
      </main>
    </>
  );
}
