import React, { useMemo } from 'react';
import {
  FuzzyAutocomplete,
  materialsToAutocomplete,
  crewsToAutocomplete,
  productionRatesToAutocomplete,
  equipmentToAutocomplete,
} from '../../components/FuzzyAutocomplete';
import { formatCurrency } from './helpers';

interface LineItemModalProps {
  lineForm: any;
  setLineForm: React.Dispatch<React.SetStateAction<any>>;
  editingLineItem: any;
  materials: any[];
  crews: any[];
  productionRates: any[];
  equipment: any[];
  onSave: () => void;
  onClose: () => void;
}

export function LineItemModal({
  lineForm,
  setLineForm,
  editingLineItem,
  materials,
  crews,
  productionRates,
  equipment,
  onSave,
  onClose,
}: LineItemModalProps) {
  const materialItems = useMemo(() => materialsToAutocomplete(materials), [materials]);
  const crewItems = useMemo(() => crewsToAutocomplete(crews), [crews]);
  const rateItems = useMemo(() => productionRatesToAutocomplete(productionRates), [productionRates]);
  const equipmentItems = useMemo(() => equipmentToAutocomplete(equipment), [equipment]);

  // ---- Material picker handler ----
  const onMaterialSelect = (item: any) => {
    if (item) {
      const mat = materials.find((m: any) => m.id === item.id);
      if (mat) {
        setLineForm((prev: any) => ({
          ...prev,
          materialId: mat.id,
          materialUnitCost: mat.default_unit_cost,
          description: prev.description || mat.name,
          unit: mat.unit,
        }));
      }
    } else {
      setLineForm((prev: any) => ({ ...prev, materialId: 0 }));
    }
  };

  // ---- Crew picker handler ----
  const onCrewSelect = (item: any) => {
    if (item) {
      const crew = crews.find((c: any) => c.id === item.id);
      if (crew) {
        const costPerHour = crew.members.reduce(
          (sum: number, m: any) => sum + m.quantity * m.default_hourly_rate * m.burden_multiplier, 0
        );
        setLineForm((prev: any) => ({
          ...prev,
          crewTemplateId: crew.id,
          laborCostPerHour: costPerHour,
        }));
      }
    } else {
      setLineForm((prev: any) => ({ ...prev, crewTemplateId: 0 }));
    }
  };

  // ---- Production rate picker handler ----
  const onProductionRateSelect = (item: any) => {
    if (item) {
      const rate = productionRates.find((r: any) => r.id === item.id);
      if (rate) {
        const hours = rate.rate_per_hour > 0 ? lineForm.quantity / rate.rate_per_hour : 0;
        const crew = crews.find((c: any) => c.id === rate.crew_template_id);
        const costPerHour = crew
          ? crew.members.reduce(
              (sum: number, m: any) => sum + m.quantity * m.default_hourly_rate * m.burden_multiplier, 0
            )
          : lineForm.laborCostPerHour;
        setLineForm((prev: any) => ({
          ...prev,
          productionRateId: rate.id,
          crewTemplateId: rate.crew_template_id,
          laborHours: Math.round(hours * 10) / 10,
          laborCostPerHour: costPerHour,
        }));
      }
    } else {
      setLineForm((prev: any) => ({ ...prev, productionRateId: 0 }));
    }
  };

  // Recalculate labor hours when quantity changes and a production rate is selected
  const onQuantityChange = (qty: number) => {
    const rate = productionRates.find((r: any) => r.id === lineForm.productionRateId);
    const hours = rate && rate.rate_per_hour > 0 ? qty / rate.rate_per_hour : lineForm.laborHours;
    setLineForm((prev: any) => ({
      ...prev,
      quantity: qty,
      laborHours: rate ? Math.round(hours * 10) / 10 : prev.laborHours,
    }));
  };

  // ---- Equipment picker handler ----
  const onEquipmentSelect = (item: any) => {
    if (item) {
      const eq = equipment.find((e: any) => e.id === item.id);
      if (eq) {
        setLineForm((prev: any) => ({
          ...prev,
          equipmentId: eq.id,
          equipmentCostPerHour: eq.hourly_rate,
          equipmentHours: prev.laborHours || prev.equipmentHours,
        }));
      }
    } else {
      setLineForm((prev: any) => ({ ...prev, equipmentId: 0 }));
    }
  };

  const formMatTotal = lineForm.quantity * lineForm.materialUnitCost;
  const formLaborTotal = lineForm.laborHours * lineForm.laborCostPerHour;
  const formEquipTotal = lineForm.equipmentHours * lineForm.equipmentCostPerHour;
  const formTotal = formMatTotal + formLaborTotal + formEquipTotal + lineForm.subcontractorCost;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 700, maxHeight: '90vh' }}>
        <h3>{editingLineItem ? 'Edit Line Item' : 'Add Line Item'}</h3>

        {/* Description */}
        <div className="form-group">
          <label>Description</label>
          <input type="text" className="form-control" value={lineForm.description}
            onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
            placeholder={`e.g. 8" PVC SDR-35 Sanitary Sewer @ 6' depth`} autoFocus />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Quantity</label>
            <input type="number" className="form-control" value={lineForm.quantity}
              onChange={(e) => onQuantityChange(parseFloat(e.target.value) || 0)} min="0" />
          </div>
          <div className="form-group">
            <label>Unit</label>
            <select className="form-control" value={lineForm.unit}
              onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value })}>
              {['LF', 'EA', 'CYD', 'SY', 'TON', 'VF', 'LS', 'HR', 'SF', 'GAL'].map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Material Section */}
        <div className="line-item-section">
          <label className="section-label">Material Cost</label>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Pick from Catalog (optional)</label>
              <FuzzyAutocomplete
                items={materialItems}
                value={lineForm.materialId || null}
                onSelect={(item) => onMaterialSelect(item)}
                placeholder="Search materials... (e.g. 8 pvc, bend, tee)"
                allowManualEntry
                manualEntryLabel="-- Manual entry --"
              />
            </div>
            <div className="form-group">
              <label>Unit Cost ($)</label>
              <input type="number" className="form-control" value={lineForm.materialUnitCost}
                onChange={(e) => setLineForm({ ...lineForm, materialUnitCost: parseFloat(e.target.value) || 0 })}
                step="0.01" min="0" />
            </div>
            <div className="form-group">
              <label>Total</label>
              <div className="form-control computed-field">{formatCurrency(formMatTotal)}</div>
            </div>
          </div>
        </div>

        {/* Labor Section */}
        <div className="line-item-section">
          <label className="section-label">Labor Cost</label>
          <div className="form-row">
            <div className="form-group">
              <label>Production Rate (optional)</label>
              <FuzzyAutocomplete
                items={rateItems}
                value={lineForm.productionRateId || null}
                onSelect={(item) => onProductionRateSelect(item)}
                placeholder="Search production rates..."
                allowManualEntry
                manualEntryLabel="-- Manual entry --"
              />
            </div>
            <div className="form-group">
              <label>Crew</label>
              <FuzzyAutocomplete
                items={crewItems}
                value={lineForm.crewTemplateId || null}
                onSelect={(item) => onCrewSelect(item)}
                placeholder="Search crews..."
                allowManualEntry
                manualEntryLabel="-- Manual entry --"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Labor Hours</label>
              <input type="number" className="form-control" value={lineForm.laborHours}
                onChange={(e) => setLineForm({ ...lineForm, laborHours: parseFloat(e.target.value) || 0 })}
                step="0.5" min="0" />
              {lineForm.productionRateId > 0 && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Auto-calculated from production rate
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Crew Cost / Hour ($)</label>
              <input type="number" className="form-control" value={lineForm.laborCostPerHour}
                onChange={(e) => setLineForm({ ...lineForm, laborCostPerHour: parseFloat(e.target.value) || 0 })}
                step="0.50" min="0" />
            </div>
            <div className="form-group">
              <label>Total</label>
              <div className="form-control computed-field">{formatCurrency(formLaborTotal)}</div>
            </div>
          </div>
        </div>

        {/* Equipment Section */}
        <div className="line-item-section">
          <label className="section-label">Equipment Cost</label>
          <div className="form-row">
            <div className="form-group">
              <label>Pick Equipment (optional)</label>
              <FuzzyAutocomplete
                items={equipmentItems}
                value={lineForm.equipmentId || null}
                onSelect={(item) => onEquipmentSelect(item)}
                placeholder="Search equipment... (e.g. excavator, backhoe)"
                allowManualEntry
                manualEntryLabel="-- Manual entry --"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Equipment Hours</label>
              <input type="number" className="form-control" value={lineForm.equipmentHours}
                onChange={(e) => setLineForm({ ...lineForm, equipmentHours: parseFloat(e.target.value) || 0 })}
                step="0.5" min="0" />
            </div>
            <div className="form-group">
              <label>Cost / Hour ($)</label>
              <input type="number" className="form-control" value={lineForm.equipmentCostPerHour}
                onChange={(e) => setLineForm({ ...lineForm, equipmentCostPerHour: parseFloat(e.target.value) || 0 })}
                step="0.50" min="0" />
            </div>
            <div className="form-group">
              <label>Total</label>
              <div className="form-control computed-field">{formatCurrency(formEquipTotal)}</div>
            </div>
          </div>
        </div>

        {/* Sub + Notes */}
        <div className="line-item-section">
          <div className="form-row">
            <div className="form-group">
              <label>Subcontractor Cost ($)</label>
              <input type="number" className="form-control" value={lineForm.subcontractorCost}
                onChange={(e) => setLineForm({ ...lineForm, subcontractorCost: parseFloat(e.target.value) || 0 })}
                step="1" min="0" />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input type="text" className="form-control" value={lineForm.notes}
                onChange={(e) => setLineForm({ ...lineForm, notes: e.target.value })} />
            </div>
          </div>
        </div>

        {/* Total bar */}
        <div style={{ background: 'var(--bg-tertiary)', padding: 16, borderRadius: 8, marginTop: 8, textAlign: 'right' }}>
          <span className="text-muted" style={{ marginRight: 16 }}>Line Item Total:</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(formTotal)}</span>
          {lineForm.quantity > 0 && (
            <span className="text-muted" style={{ marginLeft: 16 }}>
              ({formatCurrency(formTotal / lineForm.quantity)} / {lineForm.unit})
            </span>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!lineForm.description.trim()}>
            {editingLineItem ? 'Save Changes' : 'Add Line Item'}
          </button>
        </div>
      </div>
    </div>
  );
}
