import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import Loader from '../components/common/Loader';
import EmptyState from '../components/common/EmptyState';
import KpiCard from '../components/common/KpiCard';
import { usePolling } from '../hooks/usePolling';
import { getSnapshots, getEvents } from '../api/client';
import { formatDate } from '../utils/format';

export default function Analytics() {
  const { data: snapshots, loading: snapLoading, error: snapError } = usePolling(
    () => getSnapshots(50),
    10000
  );
  const { data: events } = usePolling(() => getEvents(30), 10000);

  const timeline = useMemo(() => {
    if (!snapshots) return [];
    return snapshots.map((s) => {
      const totalUnits = Object.values(s.per_product || {}).reduce((sum, c) => sum + c, 0);
      return {
        time: new Date(s.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        totalUnits,
        alerts: s.activeAlerts || 0,
        skus: Object.keys(s.per_product || {}).length,
      };
    });
  }, [snapshots]);

  const latestStats = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return null;
    const latest = snapshots[snapshots.length - 1];
    const totalUnits = Object.values(latest.per_product || {}).reduce((s, c) => s + c, 0);
    return {
      totalUnits,
      skus: Object.keys(latest.per_product || {}).length,
      alerts: latest.activeAlerts || 0,
      snapshots: snapshots.length,
    };
  }, [snapshots]);

  if (snapLoading) return <Loader text="Loading analytics…" />;
  if (snapError) return <EmptyState icon="⚠️" title="Backend unreachable" message={snapError} />;

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
        <p>Stock history timeline and automation events</p>
      </div>

      {latestStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
          <KpiCard icon="📊" label="Snapshots" value={latestStats.snapshots} sub="History records" accent="info" />
          <KpiCard icon="🔢" label="Latest Units" value={latestStats.totalUnits.toLocaleString()} accent="ok" />
          <KpiCard icon="📦" label="SKUs Detected" value={latestStats.skus} accent="info" />
          <KpiCard icon="🔔" label="Active Alerts" value={latestStats.alerts} accent={latestStats.alerts > 0 ? 'low' : 'ok'} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="glass-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
            Stock Over Time
          </h2>
          {timeline.length === 0 ? (
            <EmptyState icon="📈" title="No history yet" message="Snapshots appear after stock ingestions." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={timeline} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, fontSize: 12 }}
                />
                <Line type="monotone" dataKey="totalUnits" stroke="#06d6a0" strokeWidth={2} dot={false} name="Total Units" />
                <Line type="monotone" dataKey="alerts" stroke="#ef4444" strokeWidth={2} dot={false} name="Active Alerts" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
            Automation Events
          </h2>
          {!events || events.length === 0 ? (
            <EmptyState icon="🤖" title="No events" message="n8n webhook events will appear here." />
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {[...events].reverse().map((ev, i) => (
                <div
                  key={i}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '0.82rem',
                  }}
                >
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {ev.note || ev.type || 'Event'}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                    {formatDate(ev.receivedAt || ev.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
