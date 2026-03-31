import React, { useState } from 'react';
import {
  FuzzyAutocomplete,
  crewsToAutocomplete,
} from '../../components/FuzzyAutocomplete';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { CrewMember, CrewTemplate } from '../../../shared/types/labor';

interface ProductionRate {
  id: number;
  description: string;
  crew_template_id: number;
  crew_name: string;
  unit: string;
  rate_per_hour: number;
  conditions: string | null;
  notes: string | null;
}

interface ProductionRatesTabProps {
  rates: ProductionRate[];
  crews: CrewTemplate[];
  onRefresh: () => void;
}

export function ProductionRatesTab({ rates, crews, onRefresh }: ProductionRatesTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ProductionRate | null>(null);
  const [form, setForm] = useState({
    description: '',
    crewTemplateId: 0,
    unit: 'LF',
    ratePerHour: 0,
    conditions: '',
    notes: '',
  });

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);
  const UNITS = ['LF', 'EA', 'CYD', 'VF', 'SY', 'TON'];
  const crewItems = crewsToAutocomplete(crews);

  const openAdd = () => {
    setEditing(null);
    setForm({
      description: '',
      crewTemplateId: crews[0]?.id || 0,
      unit: 'LF',
      ratePerHour: 0,
      conditions: '',
      notes: '',
    });
    setShowModal(true);
  };

  const openEdit = (rate: ProductionRate) => {
    setEditing(rate);
    setForm({
      description: rate.description,
      crewTemplateId: rate.crew_template_id,
      unit: rate.unit,
      ratePerHour: rate.rate_per_hour,
      conditions: rate.conditions || '',
      notes: rate.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    await window.api.saveProductionRate({
      id: editing?.id,
      description: form.description,
      crewTemplateId: form.crewTemplateId,
      unit: form.unit,
      ratePerHour: form.ratePerHour,
      conditions: form.conditions || null,
      notes: form.notes || null,
    });
    setShowModal(false);
    onRefresh();
  };

  const handleDelete = () => {
    if (!editing) return;
    const rateId = editing.id;
    const rateDesc = editing.description;
    setShowModal(false);
    setConfirmState({
      msg: `Delete "${rateDesc}"? This cannot be undone.`,
      onYes: async () => {
        setConfirmState(null);
        try {
          await window.api.deleteProductionRate(rateId);
          onRefresh();
        } catch (err: any) {
          alert(err.message || 'Failed to delete production rate.');
        }
      },
    });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-16">
        <p className="text-muted">
          Define how fast a crew can install different items. Used to auto-calculate labor hours on bid line items.
        </p>
        <button className="btn btn-primary" onClick={openAdd} disabled={crews.length === 0}>
          + Add Production Rate
        </button>
      </div>

      {crews.length === 0 && (
        <div className="card mb-24">
          <p className="text-warning">You need to create at least one crew template before adding production rates.</p>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Crew</th>
            <th className="text-right">Rate</th>
            <th>Unit</th>
            <th>Conditions</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {rates.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: 32 }}>
                No production rates yet. Create crew templates first, then add production rates.
              </td>
            </tr>
          ) : (
            rates.map((rate) => (
              <tr key={rate.id}>
                <td>
                  <span className="material-name-link" onClick={() => openEdit(rate)}>
                    {rate.description}
                  </span>
                </td>
                <td>{rate.crew_name}</td>
                <td className="text-right" style={{ fontWeight: 500 }}>
                  {rate.rate_per_hour} {rate.unit}/hr
                </td>
                <td>{rate.unit}</td>
                <td className="text-muted">{rate.conditions || '--'}</td>
                <td>
                  <button className="btn btn-sm btn-secondary" onClick={() => openEdit(rate)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit Production Rate' : 'Add Production Rate'}</h3>
            <div className="form-group">
              <label>Description</label>
              <input
                type="text"
                className="form-control"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={`e.g. 8" PVC SDR-35 @ 4-6' depth`}
                autoFocus
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Crew</label>
                <FuzzyAutocomplete
                  items={crewItems}
                  value={form.crewTemplateId || null}
                  onSelect={(item) => {
                    if (item) {
                      setForm({ ...form, crewTemplateId: item.id as number });
                    }
                  }}
                  placeholder="Search crews..."
                />
              </div>
              <div className="form-group">
                <label>Unit</label>
                <select
                  className="form-control"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Rate per Hour ({form.unit}/hr)</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.ratePerHour}
                  onChange={(e) => setForm({ ...form, ratePerHour: parseFloat(e.target.value) || 0 })}
                  step="1"
                  min="0"
                />
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  e.g. "15" means the crew installs 15 {form.unit} per hour
                </div>
              </div>
              <div className="form-group">
                <label>Conditions</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.conditions}
                  onChange={(e) => setForm({ ...form, conditions: e.target.value })}
                  placeholder="e.g. Normal soil, Rock, Wet"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input
                type="text"
                className="form-control"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="modal-actions">
              {editing && (
                <button className="btn btn-danger" onClick={handleDelete} style={{ marginRight: 'auto' }}>
                  Delete Rate
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!form.description.trim() || !form.crewTemplateId}
              >
                {editing ? 'Save Changes' : 'Add Production Rate'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} />
      )}
    </div>
  );
}
