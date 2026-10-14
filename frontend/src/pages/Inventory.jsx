import React, { useState, useMemo } from 'react';
import Loader from '../components/common/Loader';
import EmptyState from '../components/common/EmptyState';
import { usePolling } from '../hooks/usePolling';
import { getPgInventory } from '../api/client';
import { formatSku, formatDate } from '../utils/format';

export default function Inventory() {
  const { data: inventory, loading, error, refetch } = usePolling(getPgInventory, 3000);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('product_id');
  const [sortDir, setSortDir] = useState('asc');

  const filtered = useMemo(() => {
    if (!inventory) return [];
    const term = search.trim().toLowerCase();
    const rows = inventory.filter((p) => p.quantity > 0).filter((p) => (
      !term ||
      String(p.product_id).includes(term) ||
      p.class_name.toLowerCase().includes(term) ||
      p.product_name.toLowerCase().includes(term)
    ));
    rows.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [inventory, search, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  if (loading) return <Loader text="Loading inventory…" />;
  if (error) {
    return (
      <EmptyState icon="⚠️" title="Could not load PostgreSQL inventory" message={error} />
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
        <p>Detected products from PostgreSQL · {filtered.length} shown</p>
      </div>

      <div className="filter-bar">
        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            placeholder="Search by product ID or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
      </div>

      <div className="glass-card" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
        {filtered.length === 0 ? (
          <EmptyState
            icon="📦"
            title={search ? 'No matching detected products' : 'No products detected'}
            message={search ? 'Try another product ID or name.' : 'Detected products with quantity above zero will appear here.'}
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className={sortKey === 'product_id' ? 'sorted' : ''} onClick={() => toggleSort('product_id')}>Product ID {sortKey === 'product_id' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={sortKey === 'product_name' ? 'sorted' : ''} onClick={() => toggleSort('product_name')}>Product {sortKey === 'product_name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={sortKey === 'quantity' ? 'sorted' : ''} onClick={() => toggleSort('quantity')}>Quantity {sortKey === 'quantity' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={sortKey === 'updated_at' ? 'sorted' : ''} onClick={() => toggleSort('updated_at')}>Last detected {sortKey === 'updated_at' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.product_id}>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{product.product_id}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>Class {product.class_id}</div>
                  </td>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{product.product_name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatSku(product.class_name)}</div>
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--color-ok)' }}>{product.quantity}</td>
                  <td className="text-muted">{formatDate(product.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
