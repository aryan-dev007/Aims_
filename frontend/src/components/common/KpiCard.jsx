import React from 'react';

export default function KpiCard({ icon, label, value, sub, accent = 'ok', delay = 0 }) {
  const accents = {
    ok:      { color: 'var(--color-ok)',      bg: 'var(--color-ok-bg)',      border: 'var(--color-ok-border)' },
    low:     { color: 'var(--color-low)',     bg: 'var(--color-low-bg)',     border: 'var(--color-low-border)' },
    warning: { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)', border: 'var(--color-warning-border)' },
    info:    { color: 'var(--color-info)',    bg: 'var(--color-info-bg)',    border: 'var(--color-info-border)' },
  };

  const a = accents[accent] || accents.ok;

  return (
    <div
      className="glass-card animate-fade-in-up"
      style={{
        padding: '22px 24px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '16px',
        animationDelay: `${delay}ms`,
        borderColor: a.border,
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: 'var(--radius-md)',
        background: a.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.3rem', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: '1.65rem', fontWeight: 700, color: a.color, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}
