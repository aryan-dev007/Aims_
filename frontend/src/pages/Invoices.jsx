import React, { useMemo, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { getStock, getInvoices, createInvoice } from '../api/client';
import { formatSku, formatDate } from '../utils/format';

let lineSeq = 0;
const emptyLine = () => ({ id: ++lineSeq, sku: '', qty: 1, unitPrice: '' });

export default function Invoices() {
  const { data: stock } = usePolling(getStock, 8000);
  const { data: invoices, loading, error, refetch } = usePolling(getInvoices, 5000);

  const [supplier, setSupplier] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');

  const products = useMemo(() => {
    const list = stock || [];
    return [...list].sort((a, b) => formatSku(a.sku).localeCompare(formatSku(b.sku)));
  }, [stock]);

  const validLines = lines.filter((l) => l.sku && Number(l.qty) > 0);
  const totalUnits = validLines.reduce((s, l) => s + Number(l.qty), 0);
  const totalAmount = validLines.reduce(
    (s, l) => s + Number(l.qty) * (Number(l.unitPrice) || 0),
    0
  );

  const updateLine = (id, patch) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)));

  const resetForm = () => {
    setSupplier('');
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setLines([emptyLine()]);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setMessage('');

    if (validLines.length === 0) {
      setFormError('Add at least one product with a quantity greater than 0.');
      return;
    }

    setBusy(true);
    try {
      const body = {
        supplier,
        invoiceNumber,
        invoiceDate,
        items: validLines.map((l) => ({
          sku: l.sku,
          name: formatSku(l.sku),
          qty: Number(l.qty),
          unitPrice: Number(l.unitPrice) || 0,
        })),
      };
      const res = await createInvoice(body);
      const appliedUnits = res?.invoice?.totalUnits ?? totalUnits;
      setMessage(`Invoice saved — ${appliedUnits} unit(s) added to stock.`);
      resetForm();
      await refetch();
    } catch (err) {
      setFormError(err.message || 'Failed to save invoice');
    } finally {
      setBusy(false);
    }
  };

  const list = invoices || [];

  return (
    <main className="app-main">
      <section className="card">
        <div className="card-head">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Add stock from invoice
          </div>
          <span className="count-chip">{products.length} products</span>
        </div>

        {formError && <p className="note note-error">{formError}</p>}
        {!formError && message && <p className="note note-ok">{message}</p>}

        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label className="field">
              <span>Supplier</span>
              <input
                className="input"
                placeholder="e.g. ABC Distributors"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Invoice number</span>
              <input
                className="input"
                placeholder="e.g. INV-2026-001"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Invoice date</span>
              <input
                className="input"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </label>
          </div>

          <div className="line-items-head">
            <span>Line items</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>
              + Add item
            </button>
          </div>

          {products.length === 0 && (
            <p className="note note-error">
              No products found — scan something on the Scanner page first.
            </p>
          )}

          <div className="line-items">
            {lines.map((line) => {
              const lineTotal = Number(line.qty) * (Number(line.unitPrice) || 0);
              return (
                <div className="line-item" key={line.id}>
                  <select
                    className="input"
                    value={line.sku}
                    onChange={(e) => updateLine(line.id, { sku: e.target.value })}
                  >
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.sku} value={p.sku}>
                        {formatSku(p.sku)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input qty"
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={line.qty}
                    onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                  />
                  <input
                    className="input price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit ₹"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                  />
                  <span className="line-total">₹{lineTotal.toFixed(2)}</span>
                  <button
                    type="button"
                    className="step-btn minus"
                    title="Remove item"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <div className="invoice-summary">
            <span className="muted small">
              {validLines.length} item{validLines.length === 1 ? '' : 's'} · {totalUnits} unit
              {totalUnits === 1 ? '' : 's'}
            </span>
            <span className="invoice-total">₹{totalAmount.toFixed(2)}</span>
          </div>

          <div className="controls">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save & add to stock'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={resetForm} disabled={busy}>
              Clear
            </button>
          </div>
        </form>
      </section>

      <section className="side">
        <div className="card">
          <div className="card-head">
            <div className="card-title" style={{ marginBottom: 0 }}>
              Recent invoices
            </div>
            <span className="count-chip">{list.length}</span>
          </div>

          {loading ? (
            <div className="chart-empty">Loading invoices…</div>
          ) : error ? (
            <p className="note note-error">{error}</p>
          ) : list.length === 0 ? (
            <div className="chart-empty">No invoices yet. Add one to stock your products.</div>
          ) : (
            <div className="invoice-list">
              {list.map((inv) => (
                <div className="invoice-item" key={inv.id}>
                  <div className="invoice-item-head">
                    <div>
                      <div className="cell-strong">
                        {inv.invoiceNumber || 'Invoice'}
                        {inv.supplier ? ` · ${inv.supplier}` : ''}
                      </div>
                      <div className="cell-muted">{formatDate(inv.createdAt)}</div>
                    </div>
                    <div className="invoice-item-total">
                      <span className="cell-strong">{inv.totalUnits} units</span>
                      <span className="cell-muted">₹{Number(inv.totalAmount || 0).toFixed(2)}</span>
                    </div>
                  </div>
                  <ul className="invoice-item-lines">
                    {inv.items.map((it, idx) => (
                      <li key={`${inv.id}-${idx}`}>
                        <span>{it.name || formatSku(it.sku)}</span>
                        <span className="muted">
                          ×{it.qty}
                          {it.unitPrice ? ` · ₹${Number(it.unitPrice).toFixed(2)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
