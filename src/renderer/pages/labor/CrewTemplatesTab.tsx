import React, { useState } from 'react';
import {
  FuzzyAutocomplete,
  laborRolesToAutocomplete,
} from '../../components/FuzzyAutocomplete';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toast-store';

interface LaborRole {
  id: number;
  name: string;
  default_hourly_rate: number;
  burden_multiplier: number;
  notes: string | null;
  aliases: string | null;
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

interface CrewTemplatesTabProps {
  crews: CrewTemplate[];
  roles: LaborRole[];
  onRefresh: () => void;
}

export function CrewTemplatesTab({ crews, roles, onRefresh }: CrewTemplatesTabProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrewTemplate | null>(null);
  const [form, setForm] = useState({ name: '', description: '', members: [] as { laborRoleId: number; quantity: number }[] });
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const roleItems = laborRolesToAutocomplete(roles);

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
    try {
      await window.api.saveCrewTemplate({
        id: editing?.id,
        name: form.name,
        description: form.description || null,
        members: form.members,
      });
      setShowModal(false);
      onRefresh();
    } catch (err: any) {
      addToast(err.message || 'Failed to save crew template.', 'error');
    }
  };

  const handleDelete = () => {
    if (!editing) return;
    const crewId = editing.id;
    const crewName = editing.name;
    setShowModal(false);
    setConfirmState({
      msg: `Delete crew "${crewName}"? This cannot be undone.`,
      onYes: async () => {
        setConfirmState(null);
        try {
          await window.api.deleteCrewTemplate(crewId);
          onRefresh();
        } catch (err: any) {
          addToast(err.message || 'Failed to delete crew template.', 'error');
        }
      },
    });
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
                    <span style={{ fontSize: 13 }}>&times;</span>
                    <div style={{ flex: 1 }}>
                      <FuzzyAutocomplete
                        items={roleItems}
                        value={member.laborRoleId}
                        onSelect={(item) => {
                          if (item) {
                            updateMember(i, 'laborRoleId', item.id as number);
                          }
                        }}
                        placeholder="Search roles..."
                      />
                    </div>
                    <button className="btn btn-sm btn-secondary" onClick={() => removeMember(i)}>
                      &times;
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
              {editing && (
                <button className="btn btn-danger" onClick={handleDelete} style={{ marginRight: 'auto' }}>
                  Delete Crew
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.name.trim()}>
                {editing ? 'Save Changes' : 'Add Crew'}
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
