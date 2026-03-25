import React, { useState, useEffect, useCallback } from 'react';

// ---- Types ----

interface LaborRole {
  id: number;
  name: string;
  default_hourly_rate: number;
  burden_multiplier: number;
  notes: string | null;
}

interface CrewMember {
  id: number;
  crew_template_id: number;
  labor_role_id: number;
  quantity: number;
  role_name: string;
  default_hourly_rate: number;
  burden_multiplier: number;
}

interface CrewTemplate {
  id: number;
  name: string;
  description: string | null;
  members: CrewMember[];
}

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

type Tab = 'roles' | 'crews' | 'rates';

export function LaborPage() {
  const [tab, setTab] = useState<Tab>('roles');
  const [roles, setRoles] = useState<LaborRole[]>([]);
  const [crews, setCrews] = useState<CrewTemplate[]>([]);
  const [rates, setRates] = useState<ProductionRate[]>([]);

  const loadAll = useCallback(async () => {
    const [r, c, p] = await Promise.all([
      window.api.getLaborRoles(),
      window.api.getCrewTemplates(),
      window.api.getProductionRates(),
    ]);
    setRoles(r);
    setCrews(c);
    setRates(p);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div>
      <div className="page-header">
        <h2>Labor & Crews</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 mb-24">
        <button
          className={`btn ${tab === 'roles' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('roles')}
        >
          Labor Roles
        </button>
        <button
          className={`btn ${tab === 'crews' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('crews')}
        >
          Crew Templates
        </button>
        <button
          className={`btn ${tab === 'rates' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('rates')}
        >
          Production Rates
        </button>
      </div>

      {tab === 'roles' && <LaborRolesTab roles={roles} onRefresh={loadAll} />}
      {tab === 'crews' && <CrewTemplatesTab crews={crews} roles={roles} onRefresh={loadAll} />}
      {tab === 'rates' && <ProductionRatesTab rates={rates} crews={crews} onRefresh={loadAll} />}
    </div>
  );
}

// ================================================================
// LABOR ROLES TAB
// ================================================================

function LaborRolesTab({ roles, onRefresh }: { roles: LaborRole[]; onRefresh: () => void }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LaborRole | null>(null);
  const [form, setForm] = useState({ name: '', defaultHourlyRate: 0, burdenMultiplier: 1.35, notes: '' });

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', defaultHourlyRate: 0, burdenMultiplier: 1.35, notes: '' });
    setShowModal(true);
  };

  const openEdit = (role: LaborRole) => {
    setEditing(role);
    setForm({
      name: role.name,
      defaultHourlyRate: role.default_hourly_rate,
      burdenMultiplier: role.burden_multiplier,
      notes: role.notes || '',
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

// ================================================================
// CREW TEMPLATES TAB
// ================================================================

function CrewTemplatesTab({
  crews,
  roles,
  onRefresh,
}: {
  crews: CrewTemplate[];
  roles: LaborRole[];
  onRefresh: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrewTemplate | null>(null);
  const [form, setForm] = useState({ name: '', description: '', members: [] as { laborRoleId: number; quantity: number }[] });

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', members: [] });
    setShowModal(true);
  };

  const openEdit = (crew: CrewTemplate) => {
    setEditing(crew);
    setForm({
      name: crew.name,
      description: crew.description || '',
      members: crew.members.map((m) => ({ laborRoleId: m.labor_role_id, quantity: m.quantity })),
    });
    setShowModal(true);
  };

  const addMember = () => {
    if (roles.length === 0) return;
    setForm({
      ...form,
      members: [...form.members, { laborRoleId: roles[0].id, quantity: 1 }],
    });
  };

  const updateMember = (index: number, field: string, value: any) => {
    const updated = [...form.members];
    (updated[index] as any)[field] = value;
    setForm({ ...form, members: updated });
  };

  const removeMember = (index: number) => {
    setForm({ ...form, members: form.members.filter((_, i) => i !== index) });
  };

  const handleSave = async () => {
    await window.api.saveCrewTemplate({
      id: editing?.id,
      name: form.name,
      description: form.description || null,
      members: form.members,
    });
    setShowModal(false);
    onRefresh();
  };

  const getCrewCostPerHour = (crew: CrewTemplate) => {
    return crew.members.reduce((sum, m) => {
      return sum + m.quantity * m.default_hourly_rate * m.burden_multiplier;
    }, 0);
  };

  const getFormCrewCost = () => {
    return form.members.reduce((sum, m) => {
      const role = roles.find((r) => r.id === m.laborRoleId);
      if (!role) return sum;
      return sum + m.quantity * role.default_hourly_rate * role.burden_multiplier;
    }, 0);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-16">
        <p className="text-muted">
          Build crew compositions from your labor roles. These are used to calculate labor costs per hour on bid line items.
        </p>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Crew</button>
      </div>

      <div className="card-grid">
        {crews.map((crew) => (
          <div key={crew.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openEdit(crew)}>
            <div className="flex justify-between items-center mb-16">
              <h3 style={{ fontSize: 15 }}>{crew.name}</h3>
              <span className="text-success" style={{ fontWeight: 600 }}>
                ${getCrewCostPerHour(crew).toFixed(2)}/hr
              </span>
            </div>
            {crew.description && (
              <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>{crew.description}</p>
            )}
            {crew.members.length > 0 ? (
              <div>
                {crew.members.map((m, i) => (
                  <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                    {m.quantity}x {m.role_name}
                    <span className="text-muted"> @ ${(m.default_hourly_rate * m.burden_multiplier).toFixed(2)}/hr</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted" style={{ fontSize: 12 }}>No members assigned</p>
            )}
          </div>
        ))}
        {crews.length === 0 && (
          <div className="card">
            <p className="text-muted">No crew templates yet. Click "+ Add Crew" to build your first crew composition.</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit Crew Template' : 'Add Crew Template'}</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Crew Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. 4-Man Pipe Crew"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="mb-16">
              <div className="flex justify-between items-center mb-16">
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Crew Members
                </label>
                <button className="btn btn-sm btn-secondary" onClick={addMember}>
                  + Add Member
                </button>
              </div>
              {form.members.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>
                  No members yet. Click "+ Add Member" to assign roles to this crew.
                </p>
              ) : (
                form.members.map((member, i) => (
                  <div key={i} className="flex gap-8 items-center mb-16">
                    <input
                      type="number"
                      className="form-control"
                      style={{ width: 60 }}
                      value={member.quantity}
                      onChange={(e) => updateMember(i, 'quantity', parseInt(e.target.value) || 1)}
                      min="1"
                    />
                    <span style={{ fontSize: 13 }}>×</span>
                    <select
                      className="form-control"
                      style={{ flex: 1 }}
                      value={member.laborRoleId}
                      onChange={(e) => updateMember(i, 'laborRoleId', parseInt(e.target.value))}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name} (${(role.default_hourly_rate * role.burden_multiplier).toFixed(2)}/hr)
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm btn-secondary" onClick={() => removeMember(i)}>
                      ×
                    </button>
                  </div>
                ))
              )}
              {form.members.length > 0 && (
                <div className="text-success" style={{ fontWeight: 600, textAlign: 'right' }}>
                  Total crew cost: ${getFormCrewCost().toFixed(2)}/hr
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.name.trim()}>
                {editing ? 'Save Changes' : 'Add Crew'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================
// PRODUCTION RATES TAB
// ================================================================

function ProductionRatesTab({
  rates,
  crews,
  onRefresh,
}: {
  rates: ProductionRate[];
  crews: CrewTemplate[];
  onRefresh: () => void;
}) {
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

  const UNITS = ['LF', 'EA', 'CY', 'VF', 'SY', 'TON'];

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
                <select
                  className="form-control"
                  value={form.crewTemplateId}
                  onChange={(e) => setForm({ ...form, crewTemplateId: parseInt(e.target.value) })}
                >
                  {crews.map((crew) => (
                    <option key={crew.id} value={crew.id}>
                      {crew.name}
                    </option>
                  ))}
                </select>
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
    </div>
  );
}
