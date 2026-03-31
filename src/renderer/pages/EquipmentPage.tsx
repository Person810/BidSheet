import React, { useState, useEffect, useCallback } from 'react';
import {
  FuzzyAutocomplete,
  simpleListToAutocomplete,
} from '../components/FuzzyAutocomplete';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface EquipmentItem {
  id: number;
  name: string;
  category: string;
  hourly_rate: number;
  daily_rate: number | null;
  mobilization_cost: number;
  fuel_cost_per_hour: number | null;
  notes: string | null;
  is_owned: number;
  is_active: number;
  aliases: string | null;
}

const EMPTY_FORM = {
  name: '',
  category: '',
  hourlyRate: 0,
  dailyRate: '',
  mobilizationCost: 0,
  fuelCostPerHour: '',
  notes: '',
  aliases: '',
  isOwned: true,
  isActive: true,
};

const CATEGORIES = [
  'Excavator', 'Backhoe', 'Loader', 'Compactor', 'Truck', 'Pump',
  'Crane', 'Trencher', 'Drill', 'Plow', 'Fusion', 'Survey',
  'Power', 'Transport', 'Other',
];

export function EquipmentPage() {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EquipmentItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadEquipment = useCallback(async () => {
    const items = await window.api.getEquipment();
    setEquipment(items);
  }, []);

  useEffect(() => {
    loadEquipment();
  }, [loadEquipment]);

  const filtered = equipment.filter((e) => {
    const matchesCategory = !filterCategory || e.category === filterCategory;
    const matchesSearch =
      !searchTerm ||
      e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.aliases || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Get unique categories from actual data for filter buttons
  const usedCategories = [...new Set(equipment.map((e) => e.category))].sort();

  const categoryItems = simpleListToAutocomplete(CATEGORIES);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (item: EquipmentItem) => {
    setEditing(item);
    setForm({
      name: item.name,
      category: item.category,
      hourlyRate: item.hourly_rate,
      dailyRate: item.daily_rate != null ? String(item.daily_rate) : '',
      mobilizationCost: item.mobilization_cost,
      fuelCostPerHour: item.fuel_cost_per_hour != null ? String(item.fuel_cost_per_hour) : '',
      notes: item.notes || '',
      aliases: item.aliases || '',
      isOwned: item.is_owned === 1,
      isActive: item.is_active === 1,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        id: editing?.id,
        name: form.name,
        category: form.category,
        hourlyRate: form.hourlyRate,
        dailyRate: form.dailyRate ? parseFloat(form.dailyRate) : null,
        mobilizationCost: form.mobilizationCost,
        fuelCostPerHour: form.fuelCostPerHour ? parseFloat(form.fuelCostPerHour) : null,
        notes: form.notes || null,
        aliases: form.aliases || null,
        isOwned: form.isOwned,
        isActive: form.isActive,
      };
      await window.api.saveEquipment(payload);
      setShowModal(false);
      loadEquipment();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setConfirmState({
      msg: 'Remove this equipment from the catalog?',
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteEquipment(id);
        loadEquipment();
      },
    });
  };

  const handleRateChange = async (item: EquipmentItem, field: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;

    const payload = {
      id: item.id,
      name: item.name,
      category: item.category,
      hourlyRate: field === 'hourly' ? num : item.hourly_rate,
      dailyRate: field === 'daily' ? num : item.daily_rate,
      mobilizationCost: field === 'mob' ? num : item.mobilization_cost,
      fuelCostPerHour: item.fuel_cost_per_hour,
      notes: item.notes,
      aliases: item.aliases || null,
      isOwned: item.is_owned === 1,
      isActive: item.is_active === 1,
    };
    await window.api.saveEquipment(payload);
    loadEquipment();
  };

  const formatCurrency = (val: number | null) => {
    if (val == null) return '--';
    return val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };

  return (
    <div>
      <div className="page-header">
        <h2>Equipment</h2>
        <div className="flex gap-8 items-center">
          <input
            type="text"
            className="form-control"
            placeholder="Search equipment..."
            style={{ width: 220 }}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openAdd}>
            + Add Equipment
          </button>
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-8 mb-16" style={{ flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${!filterCategory ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilterCategory('')}
        >
          All
        </button>
        {usedCategories.map((cat) => (
          <button
            key={cat}
            className={`btn btn-sm ${filterCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="materials-count">
        {filtered.length} piece{filtered.length !== 1 ? 's' : ''} of equipment
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Type</th>
            <th className="text-right">Hourly Rate</th>
            <th className="text-right">Daily Rate</th>
            <th className="text-right">Mobilization</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
                {searchTerm || filterCategory ? (
                  <p style={{ fontSize: 13 }}>No equipment matches your filter.</p>
                ) : (
                  <>
                    <p style={{ fontSize: 16, marginBottom: 12 }}>No equipment yet</p>
                    <p style={{ fontSize: 13, marginBottom: 20 }}>Add your first piece of equipment to start building bids.</p>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Equipment</button>
                  </>
                )}
              </td>
            </tr>
          ) : (
            filtered.map((item) => (
              <tr key={item.id}>
                <td>
                  <span className="material-name-link" onClick={() => openEdit(item)}>
                    {item.name}
                  </span>
                  {item.notes && (
                    <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {item.notes}
                    </span>
                  )}
                </td>
                <td>{item.category}</td>
                <td>
                  <span className={`badge ${item.is_owned ? 'badge-won' : 'badge-submitted'}`}>
                    {item.is_owned ? 'Owned' : 'Rented'}
                  </span>
                </td>
                <td className="text-right">
                  <input
                    type="number"
                    className="inline-price-input"
                    defaultValue={item.hourly_rate}
                    step="0.50"
                    min="0"
                    onBlur={(e) => handleRateChange(item, 'hourly', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td className="text-right text-muted">
                  {formatCurrency(item.daily_rate)}
                </td>
                <td className="text-right">
                  <input
                    type="number"
                    className="inline-price-input"
                    defaultValue={item.mobilization_cost}
                    step="25"
                    min="0"
                    onBlur={(e) => handleRateChange(item, 'mob', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleDelete(item.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} />
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit Equipment' : 'Add Equipment'}</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. CAT 320 Excavator"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <FuzzyAutocomplete
                  items={categoryItems}
                  value={form.category || null}
                  onSelect={(item) => {
                    if (item) {
                      setForm({ ...form, category: item.id as string });
                    }
                  }}
                  placeholder="Search or pick a category..."
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Hourly Rate ($)</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.hourlyRate}
                  onChange={(e) => setForm({ ...form, hourlyRate: parseFloat(e.target.value) || 0 })}
                  step="0.50"
                  min="0"
                />
              </div>
              <div className="form-group">
                <label>Daily Rate ($) (optional)</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.dailyRate}
                  onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
                  step="1"
                  min="0"
                  placeholder="--"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Mobilization Cost ($)</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.mobilizationCost}
                  onChange={(e) => setForm({ ...form, mobilizationCost: parseFloat(e.target.value) || 0 })}
                  step="25"
                  min="0"
                />
              </div>
              <div className="form-group">
                <label>Fuel Cost / Hour ($) (optional)</label>
                <input
                  type="number"
                  className="form-control"
                  value={form.fuelCostPerHour}
                  onChange={(e) => setForm({ ...form, fuelCostPerHour: e.target.value })}
                  step="0.50"
                  min="0"
                  placeholder="--"
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
                placeholder="e.g. 20-ton class, good for mainline work"
              />
            </div>
            <div className="form-group">
              <label>Also Known As (aliases for search)</label>
              <input
                type="text"
                className="form-control"
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="e.g. trackhoe, track hoe, digger"
              />
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Comma-separated alternative names for fuzzy search
              </div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textTransform: 'none', letterSpacing: 'normal', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={form.isOwned}
                  onChange={(e) => setForm({ ...form, isOwned: e.target.checked })}
                />
                Company-owned equipment (uncheck for rented)
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!form.name.trim() || !form.category || isSaving}
              >
                {isSaving ? 'Saving...' : editing ? 'Save Changes' : 'Add Equipment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
