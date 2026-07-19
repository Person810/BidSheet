import React from 'react';
import { useJobNumberWarning } from '../../hooks/useJobNumberWarning';
import { ClientField, type ClientDetailsDraft } from '../../components/ClientField';

export interface EditJobForm {
  name: string;
  jobNumber: string;
  client: string;
  location: string;
  bidDate: string;
  description: string;
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  taxPercent: number;
  escalationPercent: number;
}

interface EditJobModalProps {
  form: EditJobForm;
  setForm: (form: EditJobForm) => void;
  onSave: () => void;
  onClose: () => void;
  /** Excluded from the duplicate-number warning (a job matches itself). */
  jobId?: number;
  /** Client details draft (#94), committed by the parent's onSave. */
  clientDetails: ClientDetailsDraft | null;
  onClientDetailsChange: (details: ClientDetailsDraft | null) => void;
}

/** Edit-job info + markups modal, extracted from JobDetail. */
export function EditJobModal({
  form, setForm, onSave, onClose, jobId, clientDetails, onClientDetailsChange,
}: EditJobModalProps) {
  const numberWarning = useJobNumberWarning(form.jobNumber, jobId);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Job</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Job Name</label>
            <input type="text" className="form-control" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus />
          </div>
          <div className="form-group">
            <label>Job Number</label>
            <input type="text" className="form-control" value={form.jobNumber}
              onChange={(e) => setForm({ ...form, jobNumber: e.target.value })}
              placeholder="optional" />
            {numberWarning && (
              <div className="text-warning" style={{ fontSize: 12, marginTop: 4 }}>{numberWarning}</div>
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Client / GC</label>
            <ClientField value={form.client}
              onChange={(client) => setForm({ ...form, client })}
              details={clientDetails} onDetailsChange={onClientDetailsChange} />
          </div>
          <div className="form-group">
            <label>Bid Date</label>
            <input type="date" className="form-control" value={form.bidDate}
              onChange={(e) => setForm({ ...form, bidDate: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label>Location</label>
          <input type="text" className="form-control" value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Description</label>
          <input type="text" className="form-control" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 8px' }}>Markups &amp; Escalation</div>
        <div className="form-row">
          <div className="form-group">
            <label>Overhead %</label>
            <input type="number" className="form-control" value={form.overheadPercent} step="0.5"
              onChange={(e) => setForm({ ...form, overheadPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label>Profit %</label>
            <input type="number" className="form-control" value={form.profitPercent} step="0.5"
              onChange={(e) => setForm({ ...form, profitPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label>Bond %</label>
            <input type="number" className="form-control" value={form.bondPercent} step="0.1"
              onChange={(e) => setForm({ ...form, bondPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label>Tax %</label>
            <input type="number" className="form-control" value={form.taxPercent} step="0.1"
              onChange={(e) => setForm({ ...form, taxPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label title="Material price escalation for long-lead bids. Raises material direct cost before markups.">Escalation %</label>
            <input type="number" className="form-control" value={form.escalationPercent} step="0.5"
              onChange={(e) => setForm({ ...form, escalationPercent: parseFloat(e.target.value) || 0 })} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!form.name.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
