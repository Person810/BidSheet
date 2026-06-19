import React, { useMemo } from 'react';
import {
  FuzzyAutocomplete,
  materialsToAutocomplete,
  crewsToAutocomplete,
  productionRatesToAutocomplete,
  equipmentToAutocomplete,
} from '../../components/FuzzyAutocomplete';
import { formatCurrency } from './helpers';
import { calcCrewCostPerHour, explainCrewCost } from '../../../shared/crewCost';
import { effectiveMaterialUnitCost, isCubicYards } from '../../../shared/unitConversion';
import { CalcPopover } from '../../components/CalcPopover';
import { explainProduct, explainQuotient, explainSum, fmtMoney, fmtNum, fmtQty } from '../../../shared/calcExplain';
import { isManual, withManual, type OverridableField } from '../../../shared/manualFields';

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

  // Mark a derived field as a manual override + set its value in one go.
  const overrideField = (field: OverridableField, value: number) => {
    setLineForm((prev: any) => ({
      ...prev, [field]: value, manualFields: withManual(prev.manualFields || [], field, true),
    }));
  };

  // ---- Material picker handler ----
  // Picking a material is a fresh source for its price, so it clears any
  // existing manual override on the unit cost.
  const onMaterialSelect = (item: any) => {
    if (item) {
      const mat = materials.find((m: any) => m.id === item.id);
      if (mat) {
        setLineForm((prev: any) => {
          // A line already measured in CY keeps its unit; TON-priced
          // aggregates use their per-CY price instead of the raw $/TON
          const eff = effectiveMaterialUnitCost(mat, prev.unit);
          return {
            ...prev,
            materialId: mat.id,
            materialUnitCost: eff.converted ? eff.cost : mat.default_unit_cost,
            description: prev.description || mat.name,
            unit: eff.converted ? prev.unit : mat.unit,
            manualFields: withManual(prev.manualFields || [], 'materialUnitCost', false),
          };
        });
      }
    } else {
      setLineForm((prev: any) => ({ ...prev, materialId: 0 }));
    }
  };

  // ---- Unit change: re-price unless the cost is a manual override ----
  const onUnitChange = (newUnit: string) => {
    setLineForm((prev: any) => {
      const mat = prev.materialId ? materials.find((m: any) => m.id === prev.materialId) : null;
      let cost = prev.materialUnitCost;
      if (mat && !isManual(prev.manualFields || [], 'materialUnitCost')) {
        cost = effectiveMaterialUnitCost(mat, newUnit).cost;
      }
      return { ...prev, unit: newUnit, materialUnitCost: cost };
    });
  };

  // Warn when a CY line uses a TON-priced material with no CY price
  const selectedMaterial = lineForm.materialId
    ? materials.find((m: any) => m.id === lineForm.materialId)
    : null;
  const unitMismatch =
    selectedMaterial &&
    isCubicYards(lineForm.unit) &&
    selectedMaterial.unit === 'TON' &&
    !effectiveMaterialUnitCost(selectedMaterial, lineForm.unit).converted;
  const conversionApplied =
    selectedMaterial &&
    isCubicYards(lineForm.unit) &&
    selectedMaterial.unit === 'TON' &&
    effectiveMaterialUnitCost(selectedMaterial, lineForm.unit).converted &&
    lineForm.materialUnitCost === effectiveMaterialUnitCost(selectedMaterial, lineForm.unit).cost;

  // ---- Crew picker handler ----
  const onCrewSelect = (item: any) => {
    if (item) {
      const crew = crews.find((c: any) => c.id === item.id);
      if (crew) {
        const costPerHour = calcCrewCostPerHour(crew);
        setLineForm((prev: any) => ({
          ...prev,
          crewTemplateId: crew.id,
          laborCostPerHour: costPerHour,
          manualFields: withManual(prev.manualFields || [], 'laborCostPerHour', false),
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
          ? calcCrewCostPerHour(crew)
          : lineForm.laborCostPerHour;
        setLineForm((prev: any) => ({
          ...prev,
          productionRateId: rate.id,
          crewTemplateId: rate.crew_template_id,
          laborHours: Math.round(hours * 10) / 10,
          laborCostPerHour: costPerHour,
          // Fresh source for both hours and crew cost — clear their overrides.
          manualFields: withManual(
            withManual(prev.manualFields || [], 'laborHours', false), 'laborCostPerHour', false),
        }));
      }
    } else {
      setLineForm((prev: any) => ({ ...prev, productionRateId: 0 }));
    }
  };

  // Recalculate labor hours when quantity changes and a production rate is
  // selected — unless the user has overridden hours, which now stays put.
  const onQuantityChange = (qty: number) => {
    setLineForm((prev: any) => {
      const rate = productionRates.find((r: any) => r.id === prev.productionRateId);
      const recompute = rate && rate.rate_per_hour > 0 && !isManual(prev.manualFields || [], 'laborHours');
      return {
        ...prev,
        quantity: qty,
        laborHours: recompute ? Math.round((qty / rate.rate_per_hour) * 10) / 10 : prev.laborHours,
      };
    });
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
          manualFields: withManual(prev.manualFields || [], 'equipmentCostPerHour', false),
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

  // ---- Breakdowns for the "show the math" popovers ----
  const selectedCrew = lineForm.crewTemplateId
    ? crews.find((c: any) => c.id === lineForm.crewTemplateId)
    : null;
  const selectedRate = lineForm.productionRateId
    ? productionRates.find((r: any) => r.id === lineForm.productionRateId)
    : null;
  const selectedEquipment = lineForm.equipmentId
    ? equipment.find((e: any) => e.id === lineForm.equipmentId)
    : null;
  const u = lineForm.unit;

  // ---- Sticky overrides (§5) ----
  const manualFields: string[] = lineForm.manualFields || [];
  // The auto-computed value each override would revert to, or null when there
  // is no source to recompute from (so we don't offer a meaningless revert).
  const computedValue = (field: OverridableField): number | null => {
    switch (field) {
      case 'materialUnitCost':
        return selectedMaterial ? effectiveMaterialUnitCost(selectedMaterial, u).cost : null;
      case 'laborHours':
        return selectedRate && selectedRate.rate_per_hour > 0
          ? Math.round((lineForm.quantity / selectedRate.rate_per_hour) * 10) / 10 : null;
      case 'laborCostPerHour':
        return selectedCrew ? calcCrewCostPerHour(selectedCrew) : null;
      case 'equipmentCostPerHour':
        return selectedEquipment ? selectedEquipment.hourly_rate : null;
    }
  };
  const revert = (field: OverridableField) => {
    const v = computedValue(field);
    setLineForm((prev: any) => ({
      ...prev,
      ...(v != null ? { [field]: v } : {}),
      manualFields: withManual(prev.manualFields || [], field, false),
    }));
  };
  // Only surface the "overridden" tag when there's a source the field would
  // otherwise compute from — a hand-typed value with no catalog source behind
  // it isn't really an override of anything.
  const overrideTag = (field: OverridableField) => (
    isManual(manualFields, field) && computedValue(field) != null
      ? <OverrideTag onRevert={() => revert(field)} />
      : null
  );

  const matBreakdown = explainProduct(
    'Material total = quantity × unit cost',
    { label: 'Quantity', value: fmtQty(lineForm.quantity, u) },
    { label: 'Unit cost', value: `${fmtMoney(lineForm.materialUnitCost)}/${u}` },
    { label: 'Material total', value: fmtMoney(formMatTotal) },
  );
  const laborTotalBreakdown = explainProduct(
    'Labor total = hours × crew cost/hr',
    { label: 'Labor hours', value: `${fmtNum(lineForm.laborHours, 2)} hr` },
    { label: 'Crew cost/hr', value: fmtMoney(lineForm.laborCostPerHour) },
    { label: 'Labor total', value: fmtMoney(formLaborTotal) },
  );
  const equipTotalBreakdown = explainProduct(
    'Equipment total = hours × cost/hr',
    { label: 'Equipment hours', value: `${fmtNum(lineForm.equipmentHours, 2)} hr` },
    { label: 'Cost/hr', value: fmtMoney(lineForm.equipmentCostPerHour) },
    { label: 'Equipment total', value: fmtMoney(formEquipTotal) },
  );
  const laborHoursBreakdown = selectedRate ? explainQuotient(
    'Labor hours = quantity ÷ production rate',
    { label: 'Quantity', value: fmtQty(lineForm.quantity, u) },
    { label: 'Production rate', value: `${fmtNum(selectedRate.rate_per_hour, 2)} ${selectedRate.unit || u}/hr` },
    { label: 'Labor hours', value: `${fmtNum(lineForm.laborHours, 2)} hr` },
    'Rounded to the nearest 0.1 hr. Edit to override.',
  ) : null;
  const lineTotalBreakdown = explainSum(
    'Line total = material + labor + equipment + subcontractor',
    [
      { label: 'Material', value: fmtMoney(formMatTotal) },
      { label: 'Labor', value: fmtMoney(formLaborTotal) },
      { label: 'Equipment', value: fmtMoney(formEquipTotal) },
      { label: 'Subcontractor', value: fmtMoney(lineForm.subcontractorCost) },
    ],
    { label: 'Line total', value: fmtMoney(formTotal) },
  );

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
              onChange={(e) => onUnitChange(e.target.value)}>
              {['LF', 'EA', 'CYD', 'CY', 'SY', 'TON', 'VF', 'LS', 'HR', 'SF', 'GAL'].map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Item # (bid form)</label>
            <input type="text" className="form-control" value={lineForm.itemNumber}
              onChange={(e) => setLineForm({ ...lineForm, itemNumber: e.target.value })}
              placeholder="e.g. 201.4" />
          </div>
          <div className="form-group">
            <label>Cost Code</label>
            <input type="text" className="form-control" value={lineForm.costCode}
              onChange={(e) => setLineForm({ ...lineForm, costCode: e.target.value })}
              placeholder="e.g. 02-300" />
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
              <label>Unit Cost ($) {overrideTag('materialUnitCost')}</label>
              <input type="number" className="form-control" value={lineForm.materialUnitCost}
                onChange={(e) => overrideField('materialUnitCost', parseFloat(e.target.value) || 0)}
                step="0.01" min="0" />
            </div>
            <div className="form-group">
              <label>Total <CalcPopover breakdown={matBreakdown} ariaLabel="Show material total math" /></label>
              <div className="form-control computed-field">{formatCurrency(formMatTotal)}</div>
            </div>
          </div>
          {conversionApplied && (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Using {selectedMaterial.name}'s per-CY price ({formatCurrency(lineForm.materialUnitCost)}/CY,
              catalog {formatCurrency(selectedMaterial.default_unit_cost)}/TON).
            </p>
          )}
          {unitMismatch && (
            <p style={{ fontSize: 12, marginTop: 4, color: 'var(--warning)' }}>
              {selectedMaterial.name} is priced per TON but this line is measured in cubic yards.
              Set a "Cost per CY" or density on the material in the catalog, or adjust the unit cost manually.
            </p>
          )}
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
              <label>Labor Hours
                {laborHoursBreakdown && <CalcPopover breakdown={laborHoursBreakdown} ariaLabel="Show labor hours math" />}
                {overrideTag('laborHours')}
              </label>
              <input type="number" className="form-control" value={lineForm.laborHours}
                onChange={(e) => overrideField('laborHours', parseFloat(e.target.value) || 0)}
                step="0.5" min="0" />
              {lineForm.productionRateId > 0 && !isManual(manualFields, 'laborHours') && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Auto-calculated from production rate
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Crew Cost / Hour ($)
                {selectedCrew && <CalcPopover breakdown={explainCrewCost(selectedCrew)} ariaLabel="Show crew cost math" />}
                {overrideTag('laborCostPerHour')}
              </label>
              <input type="number" className="form-control" value={lineForm.laborCostPerHour}
                onChange={(e) => overrideField('laborCostPerHour', parseFloat(e.target.value) || 0)}
                step="0.50" min="0" />
            </div>
            <div className="form-group">
              <label>Total <CalcPopover breakdown={laborTotalBreakdown} ariaLabel="Show labor total math" /></label>
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
              <label>Cost / Hour ($) {overrideTag('equipmentCostPerHour')}</label>
              <input type="number" className="form-control" value={lineForm.equipmentCostPerHour}
                onChange={(e) => overrideField('equipmentCostPerHour', parseFloat(e.target.value) || 0)}
                step="0.50" min="0" />
            </div>
            <div className="form-group">
              <label>Total <CalcPopover breakdown={equipTotalBreakdown} ariaLabel="Show equipment total math" /></label>
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
          <CalcPopover breakdown={lineTotalBreakdown} ariaLabel="Show line total math" />
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

/** Marks a field as a manual override, with a one-click revert to computed. */
function OverrideTag({ onRevert }: { onRevert?: () => void }) {
  return (
    <span className="override-tag" title="Manually overridden — won't recompute">
      overridden
      {onRevert && (
        <button type="button" className="override-revert"
          onClick={(e) => { e.preventDefault(); onRevert(); }}>revert</button>
      )}
    </span>
  );
}
