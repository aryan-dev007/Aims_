import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import KpiCard from '../components/common/KpiCard';
import StatusBadge from '../components/common/StatusBadge';
import Loader from '../components/common/Loader';
import EmptyState from '../components/common/EmptyState';
import { usePolling } from '../hooks/usePolling';
import { useSocket } from '../hooks/useSocket';
import { getStock, getAlerts, getOrders } from '../api/client';
import { formatSku, formatDate } from '../utils/format';

export default function Dashboard() {
  const { data: stock, loading: stockLoading, error: stockError } = usePolling(getStock, 5000);
  const { data: alerts } = usePolling(getAlerts, 5000);
  const { data: orders } = usePolling(() => getOrders('pending'), 5000);
  const { latestFrame, detectorOnline, connected, latestStock } = useSocket();

  // Use real-time stock data if available, otherwise fall back to polled data
  const displayStock = useMemo(() => {
    if (latestStock && latestStock.products) return latestStock.products;
    return stock;
  }, [latestStock, stock]);

  const stats = useMemo(() => {
    const s = displayStock || stock;
    if (!s) return null;
    const totalUnits = s.reduce((sum, p) => sum + p.count, 0);
    const lowCount = s.filter((p) => p.status === 'LOW').length;
    const okCount = s.length - lowCount;
    return { totalSkus: s.length, totalUnits, lowCount, okCount };
  }, [displayStock, stock]);

  const chartData = useMemo(() => {
    const s = displayStock || stock;
    if (!s) return [];
    return [...s]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((p) => ({
        name: formatSku(p.sku).slice(0, 18),
        count: p.count,
        status: p.status,
      }));
  }, [displayStock, stock]);

  if (stockLoading) return <Loader text="Loading dashboard…" />;
  if (stockError) {
    return (
      <EmptyState
        icon="⚠️"
        title="Backend unreachable"
        message={`Could not connect to the API: ${stockError}. Make sure the backend is running on port 4000.`}
      />
    );
  }

  const recentAlerts = (alerts || []).slice(0, 5);
  const lowStock = (displayStock || stock || []).filter((p) => p.status === 'LOW').slice(0, 8);

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>Dashboard</h1>
            <p>Real-time inventory overview from YOLOv8 vision monitoring</p>
          </div>
          <div className="dashboard-connection-status">
            <span className={`connection-dot ${connected ? 'connected' : ''}`} />
            <span className="connection-label">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </div>

      <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
        <KpiCard icon="📦" label="Total SKUs" value={stats.totalSkus} sub="Products tracked" accent="info" delay={0} />
        <KpiCard icon="🔢" label="Total Units" value={stats.totalUnits.toLocaleString()} sub="On shelf" accent="ok" delay={60} />
        <KpiCard icon="🔴" label="Low Stock" value={stats.lowCount} sub="Below threshold" accent="low" delay={120} />
        <KpiCard icon="📋" label="Pending Orders" value={(orders || []).length} sub="Awaiting approval" accent="warning" delay={180} />
      </div>

      {/* Live Feed + Chart Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {/* Live Camera Feed Mini */}
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="dashboard-feed-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`live-feed-indicator ${detectorOnline ? 'active' : ''}`} />
              <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Live Camera Feed</span>
            </div>
            <Link to="/live" className="btn btn-ghost btn-sm">Full Screen</Link>
          </div>
          <div className="dashboard-feed-viewport">
            {latestFrame ? (
              <img
                src={`data:image/jpeg;base64,${latestFrame.frame}`}
                alt="Live detector feed"
                className="dashboard-feed-image"
              />
            ) : (
              <div className="dashboard-feed-placeholder">
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>📷</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  {connected ? 'Waiting for detector…' : 'Backend offline'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Run: python opencv_detect.py --source 0 --api http://localhost:4000
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="glass-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
            Top 10 Products by Count
          </h2>
          {chartData.length === 0 ? (
            <EmptyState icon="📊" title="No stock data" message="Ingest detections to see charts." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.status === 'LOW' ? '#ef4444' : '#06d6a0'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Alerts + Low Stock Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>Active Alerts</h2>
            <Link to="/alerts" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          {recentAlerts.length === 0 ? (
            <EmptyState icon="✅" title="All clear" message="No active low-stock alerts." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Count</th>
                  <th>Needed</th>
                </tr>
              </thead>
              <tbody>
                {recentAlerts.map((a) => (
                  <tr key={a.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatSku(a.sku)}</td>
                    <td className="text-low">{a.count}</td>
                    <td>{a.needed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>Low Stock Products</h2>
            <Link to="/reorder" className="btn btn-primary btn-sm">Reorder</Link>
          </div>
          {lowStock.length === 0 ? (
            <EmptyState icon="✅" title="Stock levels healthy" message="All products are above their thresholds." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Count</th>
                  <th>Threshold</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((p) => (
                  <tr key={p.sku}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatSku(p.sku)}</td>
                    <td className="text-low">{p.count}</td>
                    <td>{p.threshold}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-muted">{formatDate(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
