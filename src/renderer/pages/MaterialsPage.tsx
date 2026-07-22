import React, { useState, useEffect, useCallback } from 'react';
import {
  FuzzyAutocomplete,
  categoriesToAutocomplete,
} from '../components/FuzzyAutocomplete';
import { formatCurrency } from './jobs/helpers';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToastStore } from '../stores/toast-store';
import { CsvImportModal } from '../components/CsvImportModal';
import { SortableTh, useSortableRows } from '../components/SortableTable';
import { isMassUnit } from '../../shared/unitConversion';

const MATERIAL_SORT_ACCESSORS = {
  name: (m: Material) => m.name,
  unit: (m: Material) => m.unit,
  default_unit_cost: (m: Material) => m.default_unit_cost,
  supplier: (m: Material) => m.supplier,
  part_number: (m: Material) => m.part_number,
  last_price_update: (m: Material) => m.last_price_update,
};

interface Category {
  id: number;
  name: string;
  description: string | null;
}

interface Material {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  unit: string;
  default_unit_cost: number;
  supplier: string | null;
  part_number: string | null;
  last_price_update: string;
  notes: string | null;
  is_active: number;
  aliases: string | null;
  tons_per_cy: number | null;
  cost_per_cy: number | null;
}

const EMPTY_MATERIAL = {
  name: '',
  description: '',
  unit: 'EA',
  defaultUnitCost: 0,
  supplier: '',
  partNumber: '',
  notes: '',
  aliases: '',
  categoryId: 0,
  isActive: true,
  tonsPerCy: '',
  costPerCy: '',
};

import { unitOptions } from '../../shared/constants/units';
import { useUnitSystem } from '../stores/units-store';

export function MaterialsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const system = useUnitSystem();
  const [categories, setCategories] = useState<Category[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_MATERIAL });
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const loadCategories = useCallback(async () => {
    const cats = await window.api.getMaterialCategories();
    setCategories(cats);
    if (cats.length > 0 && selectedCategory === null) {
      setSelectedCategory(cats[0].id);
    }
  }, []);

  // Always load the full catalog; the category filter is applied
  // client-side so searching can span every category.
  const loadMaterials = useCallback(async () => {
    const mats = await window.api.getMaterials(undefined, showArchived);
    setMaterials(mats);
  }, [showArchived]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  // While a search is active it spans the whole catalog, not just the
  // selected category -- otherwise "gasket" finds nothing when you
  // happen to be sitting in Bedding & Backfill.
  const searching = searchTerm.trim().length > 0;
  const categoryMaterials =
    selectedCategory === null
      ? materials
      : materials.filter((m) => m.category_id === selectedCategory);
  const filteredMaterials = (searching ? materials : categoryMaterials).filter((m) =>
    searchTerm
      ? m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.supplier || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.part_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.aliases || '').toLowerCase().includes(searchTerm.toLowerCase())
      : true
  );
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const { sorted: sortedMaterials, sort, toggleSort } = useSortableRows(filteredMaterials, MATERIAL_SORT_ACCESSORS);

  const openAdd = () => {
    setEditingMaterial(null);
    setForm({ ...EMPTY_MATERIAL, categoryId: selectedCategory || categories[0]?.id || 0 });
    setShowModal(true);
  };

  const openEdit = (mat: Material) => {
    setEditingMaterial(mat);
    setForm({
      name: mat.name,
      description: mat.description || '',
      unit: mat.unit,
      defaultUnitCost: mat.default_unit_cost,
      supplier: mat.supplier || '',
      partNumber: mat.part_number || '',
      notes: mat.notes || '',
      aliases: mat.aliases || '',
      categoryId: mat.category_id,
      isActive: mat.is_active === 1,
      tonsPerCy: mat.tons_per_cy != null ? String(mat.tons_per_cy) : '',
      costPerCy: mat.cost_per_cy != null ? String(mat.cost_per_cy) : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        id: editingMaterial?.id,
        name: form.name,
        description: form.description || null,
        unit: form.unit,
        defaultUnitCost: form.defaultUnitCost,
        supplier: form.supplier || null,
        partNumber: form.partNumber || null,
        notes: form.notes || null,
        aliases: form.aliases || null,
        categoryId: form.categoryId,
        isActive: form.isActive,
        tonsPerCy: isMassUnit(form.unit) ? parseFloat(form.tonsPerCy) || null : null,
        costPerCy: isMassUnit(form.unit) ? parseFloat(form.costPerCy) || null : null,
      };

      await window.api.saveMaterial(payload);
      setShowModal(false);
      loadMaterials();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save material.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestore = async (id: number) => {
    await window.api.restoreMaterial(id);
    loadMaterials();
  };

  const handleDelete = async (id: number) => {
    setConfirmState({
      msg: 'Remove this material from the catalog?',
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteMaterial(id);
        loadMaterials();
      },
    });
  };

  const handlePriceChange = async (mat: Material, newPriceStr: string) => {
    const newPrice = parseFloat(newPriceStr);
    if (isNaN(newPrice) || newPrice === mat.default_unit_cost) return;
    await window.api.updateMaterialPrice(mat.id, newPrice, 'Manual');
    loadMaterials();
  };


  const categoryItems = categoriesToAutocomplete(categories);

  return (
    <div className="materials-layout">
      {/* Category sidebar */}
      <div className="materials-sidebar">
        <div className="materials-sidebar-header">
          <h3>Categories</h3>
        </div>
        <div
          className={`cat-item ${selectedCategory === null ? 'active' : ''}`}
          onClick={() => setSelectedCategory(null)}
        >
          <span>All Materials</span>
        </div>
        {categories.map((cat) => (
          <div
            key={cat.id}
            className={`cat-item ${selectedCategory === cat.id ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
          >
            <span>{cat.name}</span>
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="materials-main">
        <div className="page-header">
          <h2>
            {selectedCategory
              ? categories.find((c) => c.id === selectedCategory)?.name || 'Materials'
              : 'All Materials'}
          </h2>
          <div className="flex gap-8 items-center">
            <input
              type="text"
              className="form-control"
              placeholder="Search materials..."
              style={{ width: 250 }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <label className="flex gap-4 items-center" style={{ fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: 14, height: 14 }} />
              Show archived
            </label>
            <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
              Import Prices
            </button>
            <button className="btn btn-primary" onClick={openAdd}>
              + Add Material
            </button>
          </div>
        </div>

        <div className="materials-count">
          {filteredMaterials.length} material{filteredMaterials.length !== 1 ? 's' : ''}
          {searching && ' matching across all categories'}
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <SortableTh label="Name" sortKey="name" sort={sort} onToggle={toggleSort} />
              <SortableTh label="Unit" sortKey="unit" sort={sort} onToggle={toggleSort} />
              <SortableTh label="Unit Cost" sortKey="default_unit_cost" sort={sort} onToggle={toggleSort} className="text-right" />
              <SortableTh label="Supplier" sortKey="supplier" sort={sort} onToggle={toggleSort} />
              <SortableTh label="Part #" sortKey="part_number" sort={sort} onToggle={toggleSort} />
              <SortableTh label="Last Updated" sortKey="last_price_update" sort={sort} onToggle={toggleSort} />
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredMaterials.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
                  {searchTerm ? (
                    <p style={{ fontSize: 13 }}>No materials match your search.</p>
                  ) : (
                    <>
                      <p style={{ fontSize: 16, marginBottom: 12 }}>No materials in this category</p>
                      <p style={{ fontSize: 13, marginBottom: 20 }}>Click below to add your first material.</p>
                      <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Material</button>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              sortedMaterials.map((mat) => (
                <tr key={mat.id} style={mat.is_active === 0 ? { opacity: 0.5 } : {}}>
                  <td>
                    <span
                      className="material-name-link"
                      onClick={() => openEdit(mat)}
                    >
                      {mat.name}
                    </span>
                    {searching && (
                      <span className="badge badge-draft" style={{ marginLeft: 8, fontSize: 10 }}>
                        {categoryNames.get(mat.category_id) || 'Uncategorized'}
                      </span>
                    )}
                    {mat.is_active === 0 && (
                      <span className="badge badge-draft" style={{ marginLeft: 8, fontSize: 10 }}>archived</span>
                    )}
                    {mat.description && (
                      <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        {mat.description}
                      </span>
                    )}
                  </td>
                  <td>{mat.unit}</td>
                  <td className="text-right">
                    <input
                      // Uncontrolled input: defaultValue only applies on mount,
                      // so an external price change (e.g. a price import) would
                      // leave the stale value in the DOM and a later blur would
                      // write it back over the import. Keying on the price
                      // remounts the field when it changes upstream.
                      key={`price-${mat.default_unit_cost}`}
                      type="number"
                      className="inline-price-input"
                      defaultValue={mat.default_unit_cost}
                      step="0.01"
                      min="0"
                      onBlur={(e) => handlePriceChange(mat, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </td>
                  <td className="text-muted">{mat.supplier || '--'}</td>
                  <td className="text-muted">{mat.part_number || '--'}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    {mat.last_price_update
                      ? new Date(mat.last_price_update).toLocaleDateString()
                      : '--'}
                  </td>
                  <td>
                    {mat.is_active === 0 ? (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleRestore(mat.id)}
                        title="Restore"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleDelete(mat.id)}
                        title="Remove"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} />
      )}

      {showImportModal && (
        <CsvImportModal
          onComplete={loadMaterials}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingMaterial ? 'Edit Material' : 'Add Material'}</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder='e.g. 8" PVC SDR-35'
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <FuzzyAutocomplete
                  items={categoryItems}
                  value={form.categoryId || null}
                  onSelect={(item) => {
                    if (item) {
                      setForm({ ...form, categoryId: item.id as number });
                    }
                  }}
                  placeholder="Search categories..."
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Unit</label>
                <select
                  className="form-control"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                >
                  {unitOptions(system, form.unit).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Default Unit Cost ($)</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.defaultUnitCost}
                  onChange={(e) => {
                    const cost = parseFloat(e.target.value) || 0;
                    const density = parseFloat(form.tonsPerCy);
                    setForm({
                      ...form,
                      defaultUnitCost: cost,
                      // A set density links the volume price to this one
                      costPerCy:
                        isMassUnit(form.unit) && density > 0
                          ? (cost * density).toFixed(2)
                          : form.costPerCy,
                    });
                  }}
                  step="0.01"
                  min="0"
                />
              </div>
            </div>
            {/* Mass-priced materials carry an optional volume price: $/CY for
                TON, $/m³ for tonne (t) — same columns, unit decides meaning. */}
            {isMassUnit(form.unit) && (
              <div className="form-row">
                <div className="form-group">
                  <label>Cost per {form.unit === 't' ? 'm³' : 'CY'} ($, optional)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.costPerCy}
                    onChange={(e) => {
                      const cy = parseFloat(e.target.value);
                      const hasDensity = parseFloat(form.tonsPerCy) > 0;
                      setForm({
                        ...form,
                        costPerCy: e.target.value,
                        // Keep an existing density link consistent
                        tonsPerCy:
                          hasDensity && cy > 0 && form.defaultUnitCost > 0
                            ? (cy / form.defaultUnitCost).toFixed(2)
                            : form.tonsPerCy,
                      });
                    }}
                    step="0.01"
                    min="0"
                    placeholder={form.unit === 't' ? 'e.g. 51.00' : 'e.g. 39.20'}
                  />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Used when a bid line is measured in {form.unit === 't' ? 'cubic metres' : 'cubic yards'}
                  </span>
                </div>
                <div className="form-group">
                  <label>Density ({form.unit === 't' ? 't per m³' : 'tons per CY'}, optional)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.tonsPerCy}
                    onChange={(e) => {
                      const density = parseFloat(e.target.value);
                      setForm({
                        ...form,
                        tonsPerCy: e.target.value,
                        costPerCy:
                          density > 0 && form.defaultUnitCost > 0
                            ? (form.defaultUnitCost * density).toFixed(2)
                            : form.costPerCy,
                      });
                    }}
                    step="0.05"
                    min="0"
                    placeholder={form.unit === 't' ? 'e.g. 1.7' : 'e.g. 1.4'}
                  />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Keeps the {form.unit === 't' ? 'per-m³' : 'per-CY'} price in sync with the
                    {form.unit === 't' ? ' per-tonne' : ' per-ton'} price
                  </span>
                </div>
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label>Supplier</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.supplier}
                  onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  placeholder="e.g. Ferguson, HD Supply"
                />
              </div>
              <div className="form-group">
                <label>Part Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.partNumber}
                  onChange={(e) => setForm({ ...form, partNumber: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Description / Notes</label>
              <input
                type="text"
                className="form-control"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Also Known As (aliases for search)</label>
              <input
                type="text"
                className="form-control"
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="e.g. elbow, quarter bend, 90 degree (comma separated)"
              />
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Comma-separated alternative names. These help find this item when typing different terms.
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!form.name.trim() || !form.categoryId || isSaving}
              >
                {isSaving ? 'Saving...' : editingMaterial ? 'Save Changes' : 'Add Material'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
