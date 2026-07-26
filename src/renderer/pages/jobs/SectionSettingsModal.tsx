import React, { useState } from 'react';
import { useToastStore } from '../../stores/toast-store';
import { dismissOnEscOnly } from '../../components/modalDismiss';

interface SectionSettingsModalProps {
  section: any;
  job: any;
  onSave: (payload: {
    name: string;
    isAlternate: boolean;
    overheadPercentOverride: number | null;
    profitPercentOverride: number | null;
    bondPercentOverride: number | null;
  }) => void;
  onClose: () => void;
}

/** Parse an override field: empty string means "use job default" (null). */
function parseOverride(value: string): number | null {
  if (value.trim() === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function SectionSettingsModal({ section, job, onSave, onClose }: SectionSettingsModalProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [name, setName] = useState<string>(section.name || '');
  const [savingTemplate, setSavingTemplate] = useState(false);

  const handleSaveAsTemplate = async () => {
    setSavingTemplate(true);
    try {
      const result = await window.api.saveSectionTemplate(section.id, name.trim() || section.name);
      addToast(`Saved "${name.trim() || section.name}" as a template (${result.itemCount} items). Reuse it from "+ From Template" on any job.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to save template.', 'error');
    } finally {
      setSavingTemplate(false);
    }
  };
  const [isAlternate, setIsAlternate] = useState<boolean>(section.is_alternate === 1);
  const [overhead, setOverhead] = useState<string>(
    section.overhead_percent_override != null ? String(section.overhead_percent_override) : ''
  );
  const [profit, setProfit] = useState<string>(
    section.profit_percent_override != null ? String(section.profit_percent_override) : ''
  );
  const [bond, setBond] = useState<string>(
    section.bond_percent_override != null ? String(section.bond_percent_override) : ''
  );

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      isAlternate,
      overheadPercentOverride: parseOverride(overhead),
      profitPercentOverride: parseOverride(profit),
      bondPercentOverride: parseOverride(bond),
    });
  };

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16 }}>Section Settings</h3>

        <div className="form-group">
          <label className="form-label">Section Name</label>
          <input className="form-control" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }} />
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={isAlternate}
              onChange={(e) => setIsAlternate(e.target.checked)} style={{ margin: 0 }} />
            Bid alternate (priced separately, excluded from base bid total)
          </label>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 6px' }}>Markup Overrides</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Leave blank to use the job defaults.
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Overhead %</label>
            <input type="number" className="form-control" value={overhead} step="0.5"
              placeholder={`${job.overhead_percent ?? 0}`}
              onChange={(e) => setOverhead(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Profit %</label>
            <input type="number" className="form-control" value={profit} step="0.5"
              placeholder={`${job.profit_percent ?? 0}`}
              onChange={(e) => setProfit(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Bond %</label>
            <input type="number" className="form-control" value={bond} step="0.1"
              placeholder={`${job.bond_percent ?? 0}`}
              onChange={(e) => setBond(e.target.value)} />
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" onClick={handleSaveAsTemplate} disabled={savingTemplate}
            title="Snapshot this section's line items as a reusable package for future bids">
            {savingTemplate ? 'Saving…' : 'Save as Template'}
          </button>
          <div className="flex gap-8">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
