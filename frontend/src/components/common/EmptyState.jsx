import React from 'react';

export default function EmptyState({ icon = '📦', title = 'No data', message = 'Nothing to show right now.' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '60px 20px', textAlign: 'center',
    }} className="animate-fade-in">
      <div style={{ fontSize: '3rem', marginBottom: 16, opacity: 0.6 }}>{icon}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 320 }}>{message}</div>
    </div>
  );
}
