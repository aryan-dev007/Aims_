import React from 'react';

export default function Loader({ text = 'Loading…' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 20px', gap: 16,
    }}>
      <div style={{
        width: 36, height: 36, border: '3px solid var(--border-subtle)',
        borderTopColor: 'var(--color-ok)', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{text}</span>
    </div>
  );
}
