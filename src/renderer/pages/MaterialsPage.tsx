import React, { useState, useEffect, useCallback } from 'react';
import {
  FuzzyAutocomplete,
  categoriesToAutocomplete,
} from '../components/FuzzyAutocomplete';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CsvImportModal } from '../components/CsvImportModal';

interface Category {
  id: number;
  name: string;
  description: string;
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
};

import { UNITS } from '../../shared/constants/units';

export function MaterialsPage() {
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

  const loadCategories = useCallback(async () => {
    const cats = await window.api.getMaterialCategories();
    setCategories(cats);
    if (cats.length > 0 && selectedCategory === null) {
      setSelectedCategory(cats[0].id);
    }
  }, []);

  const loadMaterials = useCallback(async () => {
    const mats = selectedCategory
      ? await window.api.getMaterials(selectedCategory)
      : await window.api.getMaterials();
    setMaterials(mats);
  }, [selectedCategory]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  const filteredMaterials = materials.filter((m) =>
    searchTerm
      ? m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.supplier || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.part_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.aliases || '').toLowerCase().includes(searchTerm.toLowerCase())
      : true
  );

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
      };

      await window.api.saveMaterial(payload);
      setShowModal(false);
      loadMaterials();
    } finally {
      setIsSaving(false);
    }
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

  const formatCurrency = (val: number) => {
    return val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Unit</th>
              <th className="text-right">Unit Cost</th>
              <th>Supplier</th>
              <th>Part #</th>
              <th>Last Updated</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredMaterials.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: 32 }}>
                  {searchTerm
                    ? 'No materials match your search.'
                    : 'No materials in this category. Click "+ Add Material" to get started.'}
                </td>
              </tr>
            ) : (
              filteredMaterials.map((mat) => (
                <tr key={mat.id}>
                  <td>
                    <span
                      className="material-name-link"
                      onClick={() => openEdit(mat)}
                    >
                      {mat.name}
                    </span>
                    {mat.description && (
                      <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        {mat.description}
                      </span>
                    )}
                  </td>
                  <td>{mat.unit}</td>
                  <td className="text-right">
                    <input
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
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleDelete(mat.id)}
                      title="Remove"
                    >
                      Remove
                    </button>
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
                  {UNITS.map((u) => (
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
                  onChange={(e) => setForm({ ...form, defaultUnitCost: parseFloat(e.target.value) || 0 })}
                  step="0.01"
                  min="0"
                />
              </div>
            </div>
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
                Comma-separated alternative names — helps find this item when typing different terms
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
