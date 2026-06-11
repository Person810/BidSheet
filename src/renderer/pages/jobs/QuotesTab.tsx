import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatCurrency, formatDateLocal } from './helpers';
import { useToastStore } from '../../stores/toast-store';

interface QuoteForm {
  id?: number;
  scope: string;
  vendor: string;
  contact: string;
  amount: number;
  quoteDate: string;
  notes: string;
}

const EMPTY_FORM: QuoteForm = { scope: '', vendor: '', contact: '', amount: 0, quoteDate: '', notes: '' };

/**
 * Subcontractor/supplier quote tracking: competing quotes grouped by scope,
 * one selectable winner per scope, and a one-click path into the bid.
 */
export function QuotesTab({ jobId, onSendToBid }: {
  jobId: number;
  onSendToBid: (selected: { scope: string; vendor: string; amount: number; notes: string | null }[]) => Promise<void>;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<QuoteForm>({ ...EMPTY_FORM });
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void; yesLabel?: string; variant?: 'danger' | 'neutral' } | null>(null);
  const [sending, setSending] = useState(false);
  // Self-perform comparison: per-section direct cost, and which section each
  // scope is being compared against (session-local choice)
  const [sectionCosts, setSectionCosts] = useState<{ id: number; name: string; directCost: number }[]>([]);
  const [compareSections, setCompareSections] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      setQuotes(await window.api.getQuotes(jobId));
      const sections = await window.api.getBidSections(jobId);
      const costs = await Promise.all(sections.map(async (s) => {
        const items = await window.api.getBidLineItems(s.id);
        return { id: s.id, name: s.name, directCost: items.reduce((sum, i) => sum + (i.total_cost || 0), 0) };
      }));
      setSectionCosts(costs);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load quotes.', 'error');
    }
  }, [jobId, addToast]);

  useEffect(() => { load(); }, [load]);

  const scopes = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const q of quotes) {
      const list = map.get(q.scope) || [];
      list.push(q);
      map.set(q.scope, list);
    }
    return Array.from(map.entries());
  }, [quotes]);

  const existingScopes = useMemo(
    () => Array.from(new Set(quotes.map((q) => q.scope))),
    [quotes],
  );

  const selectedQuotes = quotes.filter((q) => q.is_selected === 1);

  const openNew = (scope?: string) => {
    setForm({ ...EMPTY_FORM, scope: scope || '' });
    setShowModal(true);
  };

  const openEdit = (q: any) => {
    setForm({
      id: q.id,
      scope: q.scope,
      vendor: q.vendor,
      contact: q.contact || '',
      amount: q.amount,
      quoteDate: q.quote_date ? q.quote_date.slice(0, 10) : '',
      notes: q.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.scope.trim() || !form.vendor.trim()) return;
    try {
      await window.api.saveQuote({
        id: form.id,
        jobId,
        scope: form.scope.trim(),
        vendor: form.vendor.trim(),
        contact: form.contact.trim(),
        amount: form.amount,
        quoteDate: form.quoteDate || null,
        notes: form.notes.trim() || null,
      });
      setShowModal(false);
      load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save quote.', 'error');
    }
  };

  const handleSelect = async (q: any) => {
    // Clicking the winner again clears the selection
    await window.api.selectQuote(jobId, q.scope, q.is_selected === 1 ? null : q.id);
    load();
  };

  const handleDelete = (q: any) => {
    setConfirmState({
      msg: `Delete ${q.vendor}'s quote for "${q.scope}"?`,
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteQuote(q.id);
        load();
      },
    });
  };

  const handleSendToBid = () => {
    setConfirmState({
      msg: `Add ${selectedQuotes.length} selected quote${selectedQuotes.length !== 1 ? 's' : ''} to the bid? This creates one subcontractor line item per scope in a "Subcontractors" section.`,
      yesLabel: 'Add to Bid',
      variant: 'neutral',
      onYes: async () => {
        setConfirmState(null);
        setSending(true);
        try {
          await onSendToBid(selectedQuotes.map((q) => ({
            scope: q.scope, vendor: q.vendor, amount: q.amount, notes: q.notes,
          })));
          addToast(`Added ${selectedQuotes.length} quote${selectedQuotes.length !== 1 ? 's' : ''} to the bid.`, 'success');
        } catch (err: any) {
          addToast(err?.message || 'Failed to add quotes to bid.', 'error');
        } finally {
          setSending(false);
        }
      },
    });
  };

  return (
    <div className="card mb-24">
      <div className="flex justify-between items-center mb-16">
        <div>
          <h3 style={{ fontSize: 15 }}>Subcontractor &amp; Supplier Quotes</h3>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
            Track competing quotes by scope, pick a winner, and flow it into the bid.
          </p>
        </div>
        <div className="flex gap-8">
          {selectedQuotes.length > 0 && (
            <button className="btn btn-sm btn-primary" onClick={handleSendToBid} disabled={sending}>
              {sending ? 'Adding...' : `Send ${selectedQuotes.length} to Bid`}
            </button>
          )}
          <button className="btn btn-sm btn-secondary" onClick={() => openNew()}>+ Quote</button>
        </div>
      </div>

      {quotes.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13 }}>
          No quotes yet. Click "+ Quote" to log the first one.
        </p>
      ) : (
        scopes.map(([scope, list]) => {
          const lowest = Math.min(...list.map((q: any) => q.amount));
          const compareSection = sectionCosts.find((s) => s.id === compareSections[scope]);
          const selfCost = compareSection?.directCost ?? null;
          const delta = selfCost != null ? selfCost - lowest : null;
          return (
            <div key={scope} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{scope}</span>
                <span className="text-muted" style={{ fontSize: 11 }}>
                  {list.length} quote{list.length !== 1 ? 's' : ''}
                </span>
                <button className="bid-grid-inline-action" onClick={() => openNew(scope)}>+ quote</button>
                <span style={{ flex: 1 }} />
                <label className="text-muted" style={{ fontSize: 11 }}>vs self-perform:</label>
                <select className="form-control" style={{ width: 180, fontSize: 12, padding: '2px 6px' }}
                  value={compareSections[scope] ?? ''}
                  onChange={(e) => setCompareSections({
                    ...compareSections,
                    [scope]: Number(e.target.value) || 0,
                  })}>
                  <option value="">— pick a section —</option>
                  {sectionCosts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {selfCost != null && compareSection && (
                <div style={{ fontSize: 12, marginBottom: 6, padding: '6px 10px', borderRadius: 6,
                  background: 'var(--bg-tertiary)', display: 'flex', gap: 14 }}>
                  <span>
                    Self-perform ({compareSection.name}): <strong>{formatCurrency(selfCost)}</strong> direct cost
                  </span>
                  <span>Low quote: <strong>{formatCurrency(lowest)}</strong></span>
                  {delta != null && delta !== 0 && (
                    <span style={{ color: delta > 0 ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
                      {delta > 0
                        ? `Subbing saves ${formatCurrency(delta)} (${((delta / selfCost) * 100).toFixed(0)}%)`
                        : `Self-perform saves ${formatCurrency(-delta)} (${((-delta / lowest) * 100).toFixed(0)}%)`}
                    </span>
                  )}
                </div>
              )}
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Winner</th>
                    <th>Vendor</th>
                    <th>Contact</th>
                    <th className="text-right">Amount</th>
                    <th>Date</th>
                    <th>Notes</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((q: any) => (
                    <tr key={q.id} style={q.is_selected === 1 ? { background: 'rgba(34,197,94,0.07)' } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="radio" checked={q.is_selected === 1}
                          onClick={() => handleSelect(q)} onChange={() => {}}
                          title={q.is_selected === 1 ? 'Click to clear winner' : 'Mark as winning quote'}
                          style={{ cursor: 'pointer' }} />
                      </td>
                      <td style={{ fontWeight: q.is_selected === 1 ? 600 : 400 }}>{q.vendor}</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{q.contact || '--'}</td>
                      <td className="text-right" style={{ fontWeight: 600 }}>
                        {formatCurrency(q.amount)}
                        {q.amount === lowest && list.length > 1 && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--success)' }} title="Lowest quote">LOW</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{q.quote_date ? formatDateLocal(q.quote_date) : '--'}</td>
                      <td className="text-muted" style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {q.notes || ''}
                      </td>
                      <td>
                        <div className="flex gap-8">
                          <button className="btn btn-sm btn-secondary" onClick={() => openEdit(q)}>Edit</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(q)}>&times;</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} yesLabel={confirmState.yesLabel} variant={confirmState.variant} />
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? 'Edit Quote' : 'New Quote'}</h3>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Scope of Work</label>
                <input className="form-control" value={form.scope} list="quote-scopes" autoFocus
                  onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  placeholder='e.g. "Asphalt Paving", "Dewatering"' />
                <datalist id="quote-scopes">
                  {existingScopes.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label className="form-label">Amount ($)</label>
                <input type="number" className="form-control" value={form.amount} step="100" min="0"
                  onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Vendor</label>
                <input className="form-control" value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                  placeholder="Company name" />
              </div>
              <div className="form-group">
                <label className="form-label">Contact</label>
                <input className="form-control" value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  placeholder="Name / phone / email" />
              </div>
              <div className="form-group">
                <label className="form-label">Quote Date</label>
                <input type="date" className="form-control" value={form.quoteDate}
                  onChange={(e) => setForm({ ...form, quoteDate: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <input className="form-control" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Exclusions, lead time, validity..." />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}
                disabled={!form.scope.trim() || !form.vendor.trim()}>
                {form.id ? 'Save Changes' : 'Add Quote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
