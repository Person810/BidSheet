import React, { useState, useEffect, useCallback } from 'react';
import {
  FuzzyAutocomplete,
  materialsToAutocomplete,
  productionRatesToAutocomplete,
  crewsToAutocomplete,
  equipmentToAutocomplete,
  AutocompleteItem,
} from '../components/FuzzyAutocomplete';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToastStore } from '../stores/toast-store';

// ============================================================
// LOCAL TYPES (match DB snake_case from IPC)
// ============================================================

interface AssemblyRow {
  id: number;
  name: string;
  description: string | null;
  unit: string;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  items: AssemblyItemRow[];
}

interface AssemblyItemRow {
  id: number;
  assembly_id: number;
  material_id: number;
  quantity: number;
  notes: string | null;
  material_name: string;
  material_unit: string;
  material_unit_cost: number;
}

// Form-side item (before save)
interface FormItem {
  materialId: number;
  materialName: string;
  materialUnit: string;
  materialUnitCost: number;
  quantity: number;
  notes: string;
}

import { unitOptions } from '../../shared/constants/units';
import { useUnitSystem } from '../stores/units-store';

const EMPTY_FORM = {
  name: '',
  description: '',
  unit: 'EA',
  notes: '',
  productionRateId: null as number | null,
  crewTemplateId: null as number | null,
  equipmentId: null as number | null,
  equipmentHoursPerUnit: 0,
};

// ============================================================
// PAGE COMPONENT
// ============================================================

export function AssembliesPage() {
  const addToast = useToastStore((s) => s.addToast);
  const system = useUnitSystem();
  const [assemblies, setAssemblies] = useState<AssemblyRow[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [productionRates, setProductionRates] = useState<any[]>([]);
  const [crews, setCrews] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formItems, setFormItems] = useState<FormItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ---- Data loading ----

  const loadAssemblies = useCallback(async () => {
    const rows = await window.api.getAssemblies();
    setAssemblies(rows);
  }, []);

  const loadMaterials = useCallback(async () => {
    const [mats, rates, crewList, equip] = await Promise.all([
      window.api.getMaterials(),
      window.api.getProductionRates(),
      window.api.getCrewTemplates(),
      window.api.getEquipment(),
    ]);
    setMaterials(mats);
    setProductionRates(rates);
    setCrews(crewList);
    setEquipment(equip);
  }, []);

  useEffect(() => {
    loadAssemblies();
    loadMaterials();
  }, [loadAssemblies, loadMaterials]);

  // ---- Filtering ----

  const filtered = assemblies.filter((a) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      a.name.toLowerCase().includes(term) ||
      (a.description || '').toLowerCase().includes(term) ||
      a.items.some((i) => i.material_name.toLowerCase().includes(term))
    );
  });

  // ---- Modal helpers ----

  const openNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormItems([]);
    setShowModal(true);
  };

  const openEdit = (a: AssemblyRow) => {
    setEditingId(a.id);
    setForm({
      name: a.name,
      description: a.description || '',
      unit: a.unit,
      notes: a.notes || '',
      productionRateId: (a as any).production_rate_id ?? null,
      crewTemplateId: (a as any).crew_template_id ?? null,
      equipmentId: (a as any).equipment_id ?? null,
      equipmentHoursPerUnit: (a as any).equipment_hours_per_unit ?? 0,
    });
    setFormItems(
      a.items.map((i) => ({
        materialId: i.material_id,
        materialName: i.material_name,
        materialUnit: i.material_unit,
        materialUnitCost: i.material_unit_cost,
        quantity: i.quantity,
        notes: i.notes || '',
      }))
    );
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
  };

  // ---- Add material to assembly ----

  const addMaterial = (item: AutocompleteItem | null) => {
    if (!item) return;
    // Don't add duplicates
    if (formItems.some((fi) => fi.materialId === item.id)) return;
    setFormItems((prev) => [
      ...prev,
      {
        materialId: item.id as number,
        materialName: item.label,
        materialUnit: item.unit || item.detailSub || '',
        materialUnitCost: item.default_unit_cost ?? 0,
        quantity: 1,
        notes: '',
      },
    ]);
  };

  const updateItemQty = (index: number, qty: number) => {
    setFormItems((prev) => prev.map((fi, i) => (i === index ? { ...fi, quantity: qty } : fi)));
  };

  const removeItem = (index: number) => {
    setFormItems((prev) => prev.filter((_, i) => i !== index));
  };

  // ---- Save ----

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (formItems.length === 0) return;

    setIsSaving(true);
    try {
      await window.api.saveAssembly({
        id: editingId || undefined,
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit: form.unit,
        notes: form.notes.trim() || null,
        productionRateId: form.productionRateId,
        crewTemplateId: form.crewTemplateId,
        equipmentId: form.equipmentId,
        equipmentHoursPerUnit: form.equipmentHoursPerUnit,
        items: formItems.map((fi) => ({
          materialId: fi.materialId,
          quantity: fi.quantity,
          notes: fi.notes || null,
        })),
      });

      closeModal();
      loadAssemblies();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save assembly.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ---- Delete ----

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const handleDelete = async (id: number) => {
    setConfirmState({
      msg: 'Remove this assembly?',
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteAssembly(id);
        loadAssemblies();
      },
    });
  };

  // ---- Cost calc ----

  const calcAssemblyCost = (items: { material_unit_cost: number; quantity: number }[]) =>
    items.reduce((sum, i) => sum + i.material_unit_cost * i.quantity, 0);

  const calcFormCost = () =>
    formItems.reduce((sum, fi) => sum + fi.materialUnitCost * fi.quantity, 0);

  // ---- Autocomplete items (materials not yet in form) ----

  const materialAutocomplete = materialsToAutocomplete(materials);

  // ---- Render ----

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2>Assemblies</h2>
          <p className="text-muted" style={{ marginTop: 2 }}>
            Reusable material bundles you can drop into a bid as one line item
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + New Assembly
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '1rem', maxWidth: 360 }}>
        <input
          type="text"
          className="form-control"
          placeholder="Search assemblies..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
          {assemblies.length === 0 ? (
            <>
              <p style={{ fontSize: 16, marginBottom: 12 }}>No assemblies yet</p>
              <p style={{ fontSize: 13, marginBottom: 20 }}>Create reusable item templates to speed up bid entry.</p>
              <button className="btn btn-primary" onClick={() => setShowModal(true)}>Create Assembly</button>
            </>
          ) : (
            <p style={{ fontSize: 13 }}>No matches.</p>
          )}
        </div>
      ) : (
        <div className="assembly-list">
          {filtered.map((a) => {
            const cost = calcAssemblyCost(a.items);
            const isExpanded = expandedId === a.id;
            return (
              <div key={a.id} className="assembly-card">
                <div
                  className="assembly-card-header"
                  onClick={() => setExpandedId(isExpanded ? null : a.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="assembly-card-left">
                    <span className="assembly-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                    <div>
                      <strong>{a.name}</strong>
                      {a.description && (
                        <span className="text-muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>
                          {a.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="assembly-card-right">
                    <span className="assembly-cost">${cost.toFixed(2)}</span>
                    <span className="text-muted" style={{ fontSize: '0.85em' }}>
                      /{a.unit} · {a.items.length} material{a.items.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      className="btn btn-sm"
                      onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                      style={{ marginLeft: 12 }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                      style={{ marginLeft: 4 }}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="assembly-card-body">
                    <table className="data-table" style={{ marginBottom: 0 }}>
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th style={{ width: 80, textAlign: 'right' }}>Qty</th>
                          <th style={{ width: 60, textAlign: 'center' }}>Unit</th>
                          <th style={{ width: 100, textAlign: 'right' }}>Unit Cost</th>
                          <th style={{ width: 100, textAlign: 'right' }}>Ext Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.material_name}</td>
                            <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                            <td style={{ textAlign: 'center' }}>{item.material_unit}</td>
                            <td style={{ textAlign: 'right' }}>${item.material_unit_cost.toFixed(2)}</td>
                            <td style={{ textAlign: 'right' }}>
                              ${(item.material_unit_cost * item.quantity).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>
                            Assembly Total:
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            ${cost.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    {((a as any).crew_name || (a as any).production_rate_desc || (a as any).equipment_name) && (
                      <p className="text-muted" style={{ margin: '8px 0 0', fontSize: '0.85em' }}>
                        {(a as any).production_rate_desc && <span>Labor: {(a as any).production_rate_desc}{(a as any).crew_name ? ` (${(a as any).crew_name})` : ''}</span>}
                        {!(a as any).production_rate_desc && (a as any).crew_name && <span>Crew: {(a as any).crew_name}</span>}
                        {(a as any).equipment_name && (
                          <span>
                            {((a as any).production_rate_desc || (a as any).crew_name) ? ' · ' : ''}
                            Equipment: {(a as any).equipment_name} ({(a as any).equipment_hours_per_unit} hr/{a.unit})
                          </span>
                        )}
                      </p>
                    )}
                    {a.notes && (
                      <p className="text-muted" style={{ margin: '8px 0 0', fontSize: '0.85em' }}>
                        {a.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} />
      )}

      {/* ---- Modal ---- */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            style={{ maxWidth: 700, width: '95%', outline: 'none' }}
          >
            <h3>{editingId ? 'Edit Assembly' : 'New Assembly'}</h3>

            <div>
              {/* Name + Unit row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label className="form-label">Name *</label>
                  <input
                    className="form-control"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder='e.g. 8" Water Main per LF'
                    autoFocus
                  />
                </div>
                <div>
                  <label className="form-label">Unit</label>
                  <select
                    className="form-control"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  >
                    {unitOptions(system, form.unit).map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="form-label">Description</label>
                <input
                  className="form-control"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>

              {/* Material picker */}
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="form-label">Add Material</label>
                <FuzzyAutocomplete
                  items={materialAutocomplete}
                  value={null}
                  onSelect={addMaterial}
                  placeholder="Search materials to add..."
                />
              </div>

              {/* Items table */}
              {formItems.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Bundled Materials</label>
                  <table className="data-table" style={{ marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th style={{ width: 60, textAlign: 'center' }}>Unit</th>
                        <th style={{ width: 90, textAlign: 'right' }}>Unit Cost</th>
                        <th style={{ width: 90, textAlign: 'center' }}>Qty per {form.unit}</th>
                        <th style={{ width: 90, textAlign: 'right' }}>Ext Cost</th>
                        <th style={{ width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formItems.map((fi, idx) => (
                        <tr key={fi.materialId}>
                          <td>{fi.materialName}</td>
                          <td style={{ textAlign: 'center' }}>{fi.materialUnit}</td>
                          <td style={{ textAlign: 'right' }}>${fi.materialUnitCost.toFixed(2)}</td>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              className="form-control"
                              style={{ width: 70, textAlign: 'right', padding: '2px 6px', margin: '0 auto' }}
                              value={fi.quantity}
                              min={0}
                              step="any"
                              onChange={(e) => updateItemQty(idx, parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            ${(fi.materialUnitCost * fi.quantity).toFixed(2)}
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => removeItem(idx)}
                              title="Remove"
                              style={{ padding: '1px 6px' }}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>
                          Total per {form.unit}:
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          ${calcFormCost().toFixed(2)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Labor & Equipment components */}
              <div style={{ marginBottom: '0.75rem', padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  Labor &amp; Equipment (optional)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Added as extra line items when the assembly is dropped into a bid, scaled by quantity.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label className="form-label">Production Rate</label>
                    <FuzzyAutocomplete
                      items={productionRatesToAutocomplete(productionRates)}
                      value={form.productionRateId}
                      onSelect={(item) => {
                        if (item) {
                          const rate = productionRates.find((r: any) => r.id === item.id);
                          setForm((f) => ({
                            ...f,
                            productionRateId: item.id as number,
                            // A production rate implies its crew
                            crewTemplateId: rate?.crew_template_id ?? f.crewTemplateId,
                          }));
                        } else {
                          setForm((f) => ({ ...f, productionRateId: null }));
                        }
                      }}
                      placeholder="Search production rates..."
                    />
                  </div>
                  <div>
                    <label className="form-label">Crew</label>
                    <FuzzyAutocomplete
                      items={crewsToAutocomplete(crews)}
                      value={form.crewTemplateId}
                      onSelect={(item) => setForm((f) => ({ ...f, crewTemplateId: item ? item.id as number : null }))}
                      placeholder="Search crews..."
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '0.75rem' }}>
                  <div>
                    <label className="form-label">Equipment</label>
                    <FuzzyAutocomplete
                      items={equipmentToAutocomplete(equipment)}
                      value={form.equipmentId}
                      onSelect={(item) => setForm((f) => ({ ...f, equipmentId: item ? item.id as number : null }))}
                      placeholder="Search equipment..."
                    />
                  </div>
                  <div>
                    <label className="form-label">Equip Hrs per {form.unit}</label>
                    <input
                      type="number"
                      className="form-control"
                      value={form.equipmentHoursPerUnit}
                      min={0}
                      step="any"
                      disabled={!form.equipmentId}
                      onChange={(e) => setForm((f) => ({ ...f, equipmentHoursPerUnit: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="form-label">Notes</label>
                <textarea
                  className="form-control"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes"
                  rows={2}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn" onClick={closeModal}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!form.name.trim() || formItems.length === 0 || isSaving}
              >
                {isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Assembly'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
