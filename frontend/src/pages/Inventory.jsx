import React, { useState, useMemo } from 'react';
import StatusBadge from '../components/common/StatusBadge';
import Loader from '../components/common/Loader';
import EmptyState from '../components/common/EmptyState';
import { usePolling } from '../hooks/usePolling';
import { getStock } from '../api/client';
import { formatSku, formatDate } from '../utils/format';

const FILTERS = ['ALL', 'OK', 'LOW'];

export default function Inventory() {
  const { data: stock, loading, error, refetch } = usePolling(getStock, 5000);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState('sku');
  const [sortDir, setSortDir] = useState('asc');

  const filtered = useMemo(() => {
    if (!stock) return [];
    let rows = stock.filter((p) => {
      const matchSearch = !search || p.sku.toLowerCase().includes(search.toLowerCase()) ||
        formatSku(p.sku).toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter === 'ALL' || p.status === filter;
      return matchSearch && matchFilter;
    });
    rows.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'sku') { av = a.sku; bv = b.sku; }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [stock, search, filter, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  if (loading) return <Loader text="Loading inventory…" />;
  if (error) {
    return (
      <EmptyState icon="⚠️" title="Backend unreachable" message={error} />
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
        <p>{stock.length} products tracked · {filtered.length} shown</p>
      </div>

      <div className="filter-bar">
        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            placeholder="Search by SKU or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-pills">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`filter-pill${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
      </div>

      <div className="glass-card" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="📦" title="No products found" message="Try adjusting your search or filter." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className={sortKey === 'sku' ? 'sorted' : ''} onClick={() => toggleSort('sku')}>Product {sortKey === 'sku' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={sortKey === 'count' ? 'sorted' : ''} onClick={() => toggleSort('count')}>Count {sortKey === 'count' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={sortKey === 'threshold' ? 'sorted' : ''} onClick={() => toggleSort('threshold')}>Threshold {sortKey === 'threshold' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th>Status</th>
                <th className={sortKey === 'updatedAt' ? 'sorted' : ''} onClick={() => toggleSort('updatedAt')}>Updated {sortKey === 'updatedAt' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.sku}>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatSku(p.sku)}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.sku}</div>
                  </td>
                  <td style={{ fontWeight: 600, color: p.status === 'LOW' ? 'var(--color-low)' : 'var(--color-ok)' }}>{p.count}</td>
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
  );
}
