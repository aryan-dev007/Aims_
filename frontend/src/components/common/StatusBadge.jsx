import React from 'react';

export default function StatusBadge({ status }) {
  const isLow = status === 'LOW';
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '4px 10px',
    fontSize: '0.72rem',
    fontWeight: 600,
    borderRadius: '20px',
    letterSpacing: '0.03em',
    background: isLow ? 'var(--color-low-bg)' : 'var(--color-ok-bg)',
    color: isLow ? 'var(--color-low)' : 'var(--color-ok)',
    border: `1px solid ${isLow ? 'var(--color-low-border)' : 'var(--color-ok-border)'}`,
  };

  return (
    <span style={style}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: isLow ? 'var(--color-low)' : 'var(--color-ok)',
        animation: isLow ? 'pulse 1.5s ease infinite' : 'none',
      }} />
      {status}
    </span>
  );
}
