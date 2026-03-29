import React, { useState } from 'react';

interface LaborRole {
  id: number;
  name: string;
  default_hourly_rate: number;
  burden_multiplier: number;
  notes: string | null;
  aliases: string | null;
}

interface LaborRolesTabProps {
  roles: LaborRole[];
  onRefresh: () => void;
}

export function LaborRolesTab({ roles, onRefresh }: LaborRolesTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LaborRole | null>(null);
  const [form, setForm] = useState({ name: '', defaultHourlyRate: 0, burdenMultiplier: 1.35, notes: '', aliases: '' });

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', defaultHourlyRate: 0, burdenMultiplier: 1.35, notes: '', aliases: '' });
    setShowModal(true);
  };

  const openEdit = (role: LaborRole) => {
    setEditing(role);
    setForm({
      name: role.name,
      defaultHourlyRate: role.default_hourly_rate,
      burdenMultiplier: role.burden_multiplier,
      notes: role.notes || '',
      aliases: role.aliases || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    await window.api.saveLaborRole({
      id: editing?.id,
      name: form.name,
      defaultHourlyRate: form.defaultHourlyRate,
      burdenMultiplier: form.burdenMultiplier,
      notes: form.notes || null,
      aliases: form.aliases || null,
    });
    setShowModal(false);
    onRefresh();
  };

  const handleRateChange = async (role: LaborRole, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num === role.default_hourly_rate) return;
    await window.api.saveLaborRole({
      id: role.id,
      name: role.name,
      defaultHourlyRate: num,
      burdenMultiplier: role.burden_multiplier,
      notes: role.notes,
      aliases: role.aliases || null,
    });
    onRefresh();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-16">
        <div>
          <p className="text-muted">
            Define the roles in your crews with base hourly rates and burden multipliers
            (taxes, insurance, benefits).
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Role</button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Role</th>
            <th className="text-right">Base Hourly Rate</th>
            <th className="text-right">Burden Multiplier</th>
            <th className="text-right">Burdened Rate</th>
            <th>Notes</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id}>
              <td>
                <span className="material-name-link" onClick={() => openEdit(role)}>
                  {role.name}
                </span>
              </td>
              <td className="text-right">
                <input
                  type="number"
                  className="inline-price-input"
                  defaultValue={role.default_hourly_rate}
                  step="0.50"
                  min="0"
                  onBlur={(e) => handleRateChange(role, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              </td>
              <td className="text-right">{role.burden_multiplier.toFixed(2)}x</td>
              <td className="text-right text-success">
                ${(role.default_hourly_rate * role.burden_multiplier).toFixed(2)}
              </td>
              <td className="text-muted">{role.notes || '--'}</td>
              <td>
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(role)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit Labor Role' : 'Add Labor Role'}</h3>
            <div className="form-group">
              <label>Role Name</label>
              <input
                type="text"
                className="form-control"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Operator, Pipe Layer, Laborer"
                autoFocus
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Base Hourly Rate ($)</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.defaultHourlyRate}
                  onChange={(e) => setForm({ ...form, defaultHourlyRate: parseFloat(e.target.value) || 0 })}
                  step="0.50"
                  min="0"
                />
              </div>
              <div className="form-group">
                <label>Burden Multiplier</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.burdenMultiplier}
                  onChange={(e) => setForm({ ...form, burdenMultiplier: parseFloat(e.target.value) || 1 })}
                  step="0.01"
                  min="1"
                />
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Burdened rate: ${(form.defaultHourlyRate * form.burdenMultiplier).toFixed(2)}/hr
                </div>
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
            <div className="form-group">
              <label>Also Known As (aliases for search)</label>
              <input
                type="text"
                className="form-control"
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="e.g. equipment operator, heavy equipment operator, opr"
              />
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Comma-separated alternative names for fuzzy search
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.name.trim()}>
                {editing ? 'Save Changes' : 'Add Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
