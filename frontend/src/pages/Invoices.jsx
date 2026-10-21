import React, { useMemo, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { getStock, getInvoices, createInvoice, parseInvoiceDocument } from '../api/client';
import { formatSku, formatDate } from '../utils/format';
import { useOwnerAuth } from '../components/OwnerAuthProvider';

let lineSeq = 0;
const emptyLine = () => ({ id: ++lineSeq, sku: '', qty: 1, unitPrice: '', description: '' });
const MAX_FILE_SIZE = 8 * 1024 * 1024;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('Could not read the selected file.'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function Invoices() {
  const { data: stock } = usePolling(getStock, 8000);
  const { data: invoices, loading, error, refetch } = usePolling(getInvoices, 5000);

  const [supplier, setSupplier] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [syncWarning, setSyncWarning] = useState('');
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState('');
  const [documentHash, setDocumentHash] = useState('');
  const { runOwnerAction } = useOwnerAuth();

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
    setUploadedFile('');
    setDocumentHash('');
  };

  const onUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setFormError('');
    setMessage('');
    setSyncWarning('');
    setUploadedFile('');
    setDocumentHash('');
    setLines([emptyLine()]);
    setSupplier('');
    setInvoiceNumber('');
    setInvoiceDate('');
    if (file.size > MAX_FILE_SIZE) {
      setFormError('Invoice files must be no larger than 8 MB.');
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase();
    const detectedMimeType = file.type || ({
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    }[extension] || '');
    const mimeType = detectedMimeType === 'image/jpg' ? 'image/jpeg' : detectedMimeType;
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mimeType)) {
      setFormError('Choose a PDF, PNG, JPG, or JPEG invoice.');
      return;
    }

    setUploading(true);
    try {
      const document = await readFileAsBase64(file);
      await runOwnerAction(async () => {
        const parsed = await parseInvoiceDocument({ document, mimeType });
        if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
          throw new Error('No invoice line items were identified. Enter the items manually.');
        }
        setInvoiceNumber(parsed.invoiceNumber || '');
        setInvoiceDate(parsed.invoiceDate || '');
        setSupplier(parsed.supplier || '');
        setLines(parsed.items.map((item) => ({
          id: ++lineSeq,
          sku: item.sku || '',
          qty: item.qty ?? '',
          unitPrice: item.unitPrice ?? '',
          description: item.description || '',
          confidence: item.confidence,
          matchScore: item.matchScore,
        })));
        setUploadedFile(file.name);
        setDocumentHash(parsed.documentHash || '');
        setMessage('Invoice extracted. Review every item and product match before adding stock.');
      });
    } catch (err) {
      setFormError(err.message || 'Could not process this invoice.');
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setMessage('');
    setSyncWarning('');

    if (validLines.length === 0) {
      setFormError('Add at least one product with a quantity greater than 0.');
      return;
    }
    if (documentHash && validLines.length !== lines.length) {
      setFormError('Match every extracted item to a product and enter a positive quantity before confirming.');
      return;
    }

    setBusy(true);
    try {
      const body = {
        supplier,
        invoiceNumber,
        invoiceDate,
        documentHash: documentHash || undefined,
        items: validLines.map((l) => ({
          sku: l.sku,
          name: l.description || formatSku(l.sku),
          qty: Number(l.qty),
          unitPrice: Number(l.unitPrice) || 0,
        })),
      };
      await runOwnerAction(async () => {
        const res = await createInvoice(body);
        const appliedUnits = res?.invoice?.totalUnits ?? totalUnits;
        setMessage(`Invoice saved — ${appliedUnits} unit(s) added to stock.`);
        if (res?.postgres?.error) {
          setSyncWarning('PostgreSQL inventory sync failed; verify the database before relying on its reports.');
        } else if (res?.postgres?.unknown?.length) {
          setSyncWarning(`PostgreSQL did not recognize ${res.postgres.unknown.length} product(s); check the product records.`);
        }
        resetForm();
        await refetch();
      });
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
        {!formError && message && <p className={syncWarning ? 'note note-error' : 'note note-ok'}>{message}{syncWarning && ` ${syncWarning}`}</p>}

        <div className="invoice-upload">
          <div>
            <strong>Upload invoice for automatic extraction</strong>
            <p className="muted small">
              PDF, PNG, or JPG up to 8 MB. OCR suggestions must be reviewed before stock changes.
            </p>
          </div>
          <label className="btn btn-secondary invoice-upload-button">
            {uploading ? 'Reading invoice…' : uploadedFile ? 'Choose another file' : 'Choose invoice file'}
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={onUpload}
              disabled={uploading || busy}
            />
          </label>
          {uploadedFile && <span className="muted small">{uploadedFile}</span>}
        </div>

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
                    <div className="invoice-product-cell">
                      {line.description && (
                        <span className="invoice-ocr-description" title={line.description}>
                          OCR: {line.description}
                          {line.suggestedSku && ` · suggestion: ${formatSku(line.suggestedSku)}`}
                          {Number.isFinite(line.matchScore) && ` · match ${Math.round(line.matchScore * 100)}%`}
                          {Number.isFinite(line.confidence) && ` · OCR ${Math.round(line.confidence * 100)}%`}
                        </span>
                      )}
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
                    </div>
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
            <button className="btn btn-primary" type="submit" disabled={busy || uploading}>
              {busy ? 'Saving…' : documentHash ? 'Confirm invoice & update stock' : 'Save & add to stock'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={resetForm} disabled={busy || uploading}>
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
