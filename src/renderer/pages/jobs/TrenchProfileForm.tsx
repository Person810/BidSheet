import React, { useMemo, useState } from 'react';
import {
  parsePipeSizeFromName, depthZoneBreakdown,
  type TrenchInput, type ValidationError,
} from '../../modules/underground/trenchCalc';
import { calculateHDD } from '../../modules/underground/hddCalc';
import { FuzzyAutocomplete, type AutocompleteItem } from '../../components/FuzzyAutocomplete';
import { NATIVE_MATERIAL_ITEM } from '../../modules/underground/useTrenchMaterials';
import { trenchInputToTakeoffRun, TRENCH_PREVIEW_SCALE_PX_PER_FT } from '../../modules/underground/trenchInputToRun';
import { buildGroundSampler } from '../../modules/underground/plan-takeoff/surfaceSampler';
import type { TakeoffRun, TakeoffSurface } from '../../modules/underground/plan-takeoff/types';
import { DepthZoneTable } from '../../modules/underground/DepthZoneTable';
import { UnitInput } from '../../components/UnitInput';
import { useUnitSystem } from '../../stores/units-store';
import { unitLabel, formatPipeSize, toDisplay, fromDisplay } from '../../../shared/unitSystem';
import { formatCurrency } from './helpers';

const Trench3DView = React.lazy(() =>
  import('../../modules/underground/plan-takeoff/Trench3DView').then((m) => ({ default: m.Trench3DView })));

interface FormData extends TrenchInput {
  label: string;
  pipeMaterialId: number | string | null;
  beddingMaterialId: number | string | null;
  backfillMaterialId: number | string | null;
  method?: string; // 'open_cut' | 'hdd'
  hddLocation?: string;
  hddIncludeSlurry?: boolean;
  hddIncludePits?: boolean;
  hddMarginPct?: number;
  hddBoresPerPit?: number;
  hddAdditionalPipesJson?: string;
}

interface Props {
  form: FormData;
  onChange: (field: string, value: any) => void;
  onSave: () => void;
  onCancel: () => void;
  errors: ValidationError[];
  pipeMaterials: AutocompleteItem[];
  beddingMaterials: AutocompleteItem[];
  /** Runs already drawn on this job's Plan Takeoff PDF, for the "preview against the plan" option below. */
  takeoffRuns: TakeoffRun[];
  /** PDF page number -> real px/ft scale, so a linked run renders at true scale. */
  pageScales: Record<number, number>;
  /** The job's surveyed-terrain surface, if any, so a linked run can ground against real elevations. */
  surface: TakeoffSurface | null;
  customRates?: any;
}

export function TrenchProfileForm({
  form, onChange, onSave, onCancel, errors, pipeMaterials, beddingMaterials,
  takeoffRuns, pageScales, surface, customRates,
}: Props) {
  const system = useUnitSystem();
  const isMetric = system === 'metric';
  const hasError = (field: string) => errors.some((e) => e.field === field);
  const [linkedRunId, setLinkedRunId] = useState<number | null>(null);
  const linkedRun = takeoffRuns.find((r) => r.id === linkedRunId) ?? null;

  const isHDD = form.method === 'hdd';

  const additionalPipes = useMemo(() => {
    const jsonStr = form.hddAdditionalPipesJson || (form.backfillType && form.backfillType.startsWith('[') ? form.backfillType : '');
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          return parsed as Array<{ pipeSizeIn: number; pipeMaterialId: number | string | null }>;
        }
      } catch {
        return [];
      }
    }
    return [];
  }, [form.hddAdditionalPipesJson, form.backfillType]);

  const addAdditionalPipe = () => {
    const defaultSizeIn = form.pipeSizeIn || (isMetric ? 3.937 : 3.0);
    const newList = [...additionalPipes, { pipeSizeIn: defaultSizeIn, pipeMaterialId: form.pipeMaterialId || null, pipeMaterial: form.pipeMaterial || '' }];
    onChange('hddAdditionalPipesJson', JSON.stringify(newList));
  };

  const removeAdditionalPipe = (index: number) => {
    const newList = [...additionalPipes];
    newList.splice(index, 1);
    onChange('hddAdditionalPipesJson', JSON.stringify(newList));
  };

  const onChangeAdditionalPipe = (index: number, field: 'pipeSizeIn' | 'pipeMaterialId', value: any) => {
    const newList = [...additionalPipes];
    newList[index] = { ...newList[index], [field]: value };
    onChange('hddAdditionalPipesJson', JSON.stringify(newList));
  };

  const depthZones = useMemo(
    () => (!isHDD && errors.length === 0 ? depthZoneBreakdown(form) : []),
    [form, errors, isHDD]
  );

  const backfillItems = useMemo(
    () => [NATIVE_MATERIAL_ITEM, ...beddingMaterials],
    [beddingMaterials]
  );

  const selectedPipe = pipeMaterials.find((m) => m.id === form.pipeMaterialId);
  const selectedBedding = beddingMaterials.find((m) => m.id === form.beddingMaterialId);

  const standardSizes = isMetric
    ? [63, 90, 110, 160, 200, 250, 300, 355, 400, 450, 500, 560, 630, 710]
    : [2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28];

  const hddOutput = useMemo(() => {
    if (!isHDD || errors.length > 0) return null;
    try {
      return calculateHDD({
        location: (form.hddLocation as any) || 'metro',
        dn: form.pipeSizeIn,
        length: form.runLengthLF,
        includeSlurry: form.backfillType !== 'bundle' && form.hddIncludeSlurry !== false,
        includePits: form.backfillType !== 'bundle' && form.hddIncludePits !== false,
        marginPct: form.hddMarginPct ?? 15,
        locale: isMetric ? 'en-AU' : 'en-US',
        boresPerPit: form.hddBoresPerPit ?? 1,
        isBundle: form.backfillType === 'bundle',
        additionalPipes: additionalPipes,
        customRates,
      });
    } catch (e) {
      return null;
    }
  }, [form, errors, isHDD, isMetric, additionalPipes, customRates]);

  return (
    <div style={{ padding: '12px 0' }}>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>Method</label>
          <select
            className="form-control"
            value={form.method || 'open_cut'}
            onChange={(e) => {
              const nextVal = e.target.value;
              onChange('method', nextVal);
              if (nextVal === 'hdd') {
                if (!form.trenchWidthFt || form.trenchWidthFt === 2.0) onChange('trenchWidthFt', isMetric ? 3.28 : 3.0);
                if (!form.benchWidthFt || form.benchWidthFt === 0) onChange('benchWidthFt', isMetric ? 6.56 : 6.0);
                if (!form.startDepthFt || form.startDepthFt === 3.0) onChange('startDepthFt', isMetric ? 4.92 : 5.0);
              }
            }}
          >
            <option value="open_cut">Open Cut Trenching</option>
            <option value="hdd">Horizontal Directional Drilling (HDD)</option>
          </select>
        </div>
      </div>

      {!isHDD ? (
        <>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Label</label>
              <input type="text" className="form-control" placeholder="e.g. MH-1 to MH-2"
                value={form.label} onChange={(e) => onChange('label', e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 3 }}>
              <label>Pipe Material</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <FuzzyAutocomplete
                    items={pipeMaterials}
                    value={form.pipeMaterialId}
                    onSelect={(item) => {
                      if (item) {
                        onChange('pipeMaterialId', item.id);
                        onChange('pipeMaterial', item.label);
                        const size = parsePipeSizeFromName(item.label);
                        if (size > 0) onChange('pipeSizeIn', size);
                      } else {
                        onChange('pipeMaterialId', null);
                        onChange('pipeMaterial', '');
                      }
                    }}
                    placeholder="Search pipe (e.g. 8 PVC)"
                  />
                </div>
                {selectedPipe && selectedPipe.detail && (
                  <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {selectedPipe.detail}/{selectedPipe.detailSub || 'LF'}
                  </span>
                )}
              </div>
            </div>
            <div className="form-group" style={{ flex: 1.5 }}>
              <label>Standard Pipe Size</label>
              <select
                className="form-control"
                value={standardSizes.find((s) => Math.abs(s - form.pipeSizeIn) < 0.01) ?? 'custom'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== 'custom') {
                    onChange('pipeSizeIn', Number(val));
                  }
                }}
              >
                {standardSizes.map((s) => (
                  <option key={s} value={s}>
                    {formatPipeSize(s, system)}
                  </option>
                ))}
                <option value="custom">Custom size...</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1.5 }}>
              <label>Pipe Size ({isMetric ? 'mm' : 'inches'})</label>
              {/* eslint-disable-next-line no-restricted-syntax -- Pipe size is a direct mm/inch dimension input */}
              <input
                type="number"
                className={`form-control ${hasError('pipeSizeIn') ? 'input-error' : ''}`}
                value={toDisplay(form.pipeSizeIn, 'in', system)}
                onChange={(e) => onChange('pipeSizeIn', fromDisplay(parseFloat(e.target.value) || 0, 'in', system))}
              />
            </div>
          </div>

          {!isHDD && (
            <div style={{ marginTop: 12, marginBottom: 12, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>
                    Additional Pipes & Conduits in Trench ({additionalPipes.length})
                  </label>
                  <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>
                    Configure extra pipes or conduits running in this trench run
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={addAdditionalPipe}
                  style={{ fontSize: 12, padding: '4px 10px' }}>
                  + Add Pipe / Conduit
                </button>
              </div>

              {additionalPipes.map((p, idx) => (
                <div key={idx} className="form-row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: 12, width: 65, paddingBottom: 8 }}>
                    Pipe {idx + 2}:
                  </div>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label>Pipe Material</label>
                    <select className="form-control"
                      value={p.pipeMaterialId ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const found = pipeMaterials.find((m) => String(m.id) === String(val));
                        onChangeAdditionalPipe(idx, 'pipeMaterialId', found ? found.id : (val || null));
                      }}>
                      <option value="">Select material...</option>
                      {pipeMaterials.map((m) => (
                        <option key={String(m.id)} value={String(m.id)}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1.5 }}>
                    <label>Standard Size</label>
                    <select className="form-control"
                      value={standardSizes.find((s) => Math.abs(s - p.pipeSizeIn) < 0.01) ?? 'custom'}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== 'custom') {
                          onChangeAdditionalPipe(idx, 'pipeSizeIn', parseFloat(val));
                        }
                      }}>
                      {standardSizes.map((s) => (
                        <option key={s} value={s}>{formatPipeSize(s, system)}</option>
                      ))}
                      <option value="custom">Custom size...</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1.5 }}>
                    <label>Pipe Size ({isMetric ? 'mm' : 'inches'})</label>
                    {/* eslint-disable-next-line no-restricted-syntax -- Pipe size is a direct mm/inch dimension input */}
                    <input type="number" className="form-control"
                      value={toDisplay(p.pipeSizeIn, 'in', system)}
                      onChange={(e) => onChangeAdditionalPipe(idx, 'pipeSizeIn', fromDisplay(parseFloat(e.target.value) || 0, 'in', system))} />
                  </div>
                  <div className="form-group" style={{ flex: '0 0 auto', paddingBottom: 2 }}>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => removeAdditionalPipe(idx)}
                      title="Remove pipe"
                      style={{ padding: '6px 10px' }}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Start Depth{system === 'metric' ? '' : ' (ft)'}</label>
              <UnitInput kind="ft" mmToggle className={`form-control ${hasError('startDepthFt') ? 'input-error' : ''}`}
                value={form.startDepthFt} step={0.5} metricStep={0.1} min={0}
                onChange={(v) => onChange('startDepthFt', v)} />
            </div>
            <div className="form-group">
              <label>Grade (%)</label>
              <input type="number" className={`form-control ${hasError('gradePct') ? 'input-error' : ''}`}
                value={form.gradePct} step="0.1" min="0"
                onChange={(e) => onChange('gradePct', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Run Length ({unitLabel('lf', system)})</label>
              <UnitInput kind="lf" className={`form-control ${hasError('runLengthLF') ? 'input-error' : ''}`}
                value={form.runLengthLF} step={1} metricStep={1} min={0}
                onChange={(v) => onChange('runLengthLF', v)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Trench Width{system === 'metric' ? '' : ' (ft)'}</label>
              <UnitInput kind="ft" mmToggle className={`form-control ${hasError('trenchWidthFt') ? 'input-error' : ''}`}
                value={form.trenchWidthFt} step={0.5} metricStep={0.1} min={0}
                onChange={(v) => onChange('trenchWidthFt', v)} />
            </div>
            <div className="form-group">
              <label>Bench Width{system === 'metric' ? '' : ' (ft)'}</label>
              <UnitInput kind="ft" mmToggle className={`form-control ${hasError('benchWidthFt') ? 'input-error' : ''}`}
                value={form.benchWidthFt} step={0.5} metricStep={0.1} min={0}
                onChange={(v) => onChange('benchWidthFt', v)} />
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label>Bedding Material</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <FuzzyAutocomplete
                    items={beddingMaterials}
                    value={form.beddingMaterialId}
                    onSelect={(item) => {
                      onChange('beddingMaterialId', item ? item.id : null);
                    }}
                    placeholder="Search bedding..."
                  />
                </div>
                {selectedBedding && selectedBedding.detail && (
                  <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {selectedBedding.detail}/{selectedBedding.detailSub || ''}
                  </span>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Bedding Depth{system === 'metric' ? '' : ' (ft)'}</label>
              <UnitInput kind="ft" mmToggle className={`form-control ${hasError('beddingDepthFt') ? 'input-error' : ''}`}
                value={form.beddingDepthFt} step={0.25} metricStep={0.05} min={0}
                onChange={(v) => onChange('beddingDepthFt', v)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Backfill Type</label>
              <FuzzyAutocomplete
                items={backfillItems}
                value={form.backfillMaterialId}
                onSelect={(item) => {
                  if (item) {
                    onChange('backfillMaterialId', item.id);
                    onChange('backfillType', item.label);
                  } else {
                    onChange('backfillMaterialId', null);
                    onChange('backfillType', '');
                  }
                }}
                placeholder="Search backfill..."
              />
            </div>
            <div className="form-group">
              <label>Compaction/Waste (%)</label>
              <input type="number" className={`form-control ${hasError('compactionPct') ? 'input-error' : ''}`}
                value={form.compactionPct ?? 0} step="1" min="0" max="100"
                onChange={(e) => onChange('compactionPct', parseFloat(e.target.value) || 0)} />
              <span className="text-muted" style={{ fontSize: 11 }}>
                Extra loose material on imported bedding/backfill. Native backfill is never adjusted.
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Label</label>
              <input type="text" className="form-control" placeholder="e.g. HDD Bore Run 1"
                value={form.label} onChange={(e) => onChange('label', e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Location Type</label>
              <select
                className="form-control"
                value={form.hddLocation || 'metro'}
                onChange={(e) => onChange('hddLocation', e.target.value)}
              >
                <option value="metro">Metro</option>
                <option value="regional">Regional</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Standard Pipe Size</label>
              <select
                className="form-control"
                value={standardSizes.includes(form.pipeSizeIn) ? form.pipeSizeIn : 'custom'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== 'custom') {
                    onChange('pipeSizeIn', Number(val));
                  }
                }}
              >
                {standardSizes.map((s) => (
                  <option key={s} value={s}>
                    {isMetric ? `DN${s}` : `${s}"`}
                  </option>
                ))}
                <option value="custom">Custom size...</option>
              </select>
            </div>
            {(!standardSizes.includes(form.pipeSizeIn) || standardSizes.includes(form.pipeSizeIn)) && (
              <div className="form-group">
                <label>Pipe Size ({isMetric ? 'mm' : 'inches'})</label>
                <input
                  type="number"
                  className={`form-control ${hasError('pipeSizeIn') ? 'input-error' : ''}`}
                  value={form.pipeSizeIn}
                  onChange={(e) => onChange('pipeSizeIn', parseFloat(e.target.value) || 0)}
                />
              </div>
            )}
            <div className="form-group">
              <label>Bore Length ({unitLabel('lf', system)})</label>
              <UnitInput kind="lf" className={`form-control ${hasError('runLengthLF') ? 'input-error' : ''}`}
                value={form.runLengthLF} step={1} metricStep={1} min={0}
                onChange={(v) => onChange('runLengthLF', v)} />
            </div>
            <div className="form-group">
              <label>Grade (%)</label>
              <input type="number" className={`form-control ${hasError('gradePct') ? 'input-error' : ''}`}
                value={form.gradePct} step="0.1" min="0"
                onChange={(e) => onChange('gradePct', parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                <input type="checkbox" checked={form.hddIncludeSlurry !== false}
                  onChange={(e) => onChange('hddIncludeSlurry', e.target.checked)} />
                Include Slurry Disposal
              </label>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                <input type="checkbox" checked={form.hddIncludePits !== false}
                  disabled={form.backfillType === 'bundle'}
                  onChange={(e) => onChange('hddIncludePits', e.target.checked)} />
                Include Launch & Exit Pits Excavation
              </label>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                <input type="checkbox" checked={form.backfillType === 'bundle'}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onChange('backfillType', checked ? 'bundle' : '');
                  }} />
                Bundle Pipe (Exclude Rig/Crew/Pits)
              </label>
            </div>
            <div className="form-group">
              <label>Margin (%)</label>
              <input type="number" className="form-control" value={form.hddMarginPct ?? 15} step="1" min="0" max="100"
                onChange={(e) => onChange('hddMarginPct', parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          {form.backfillType !== 'bundle' && form.hddIncludePits !== false && (
            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label>Launch Pit Width ({unitLabel('ft', system)})</label>
                <UnitInput kind="ft" className={`form-control ${hasError('trenchWidthFt') ? 'input-error' : ''}`}
                  value={form.trenchWidthFt ?? (isMetric ? 1.0 : 3.0)} step={0.5} metricStep={0.1} min={0}
                  onChange={(v) => onChange('trenchWidthFt', v)} />
              </div>
              <div className="form-group">
                <label>Launch Pit Length ({unitLabel('ft', system)})</label>
                <UnitInput kind="ft" className={`form-control ${hasError('benchWidthFt') ? 'input-error' : ''}`}
                  value={form.benchWidthFt ?? (isMetric ? 2.0 : 6.0)} step={0.5} metricStep={0.1} min={0}
                  onChange={(v) => onChange('benchWidthFt', v)} />
              </div>
              <div className="form-group">
                <label>Launch Pit Depth ({unitLabel('ft', system)})</label>
                <UnitInput kind="ft" className={`form-control ${hasError('startDepthFt') ? 'input-error' : ''}`}
                  value={form.startDepthFt ?? (isMetric ? 1.5 : 5.0)} step={0.5} metricStep={0.1} min={0}
                  onChange={(v) => onChange('startDepthFt', v)} />
              </div>
              <div className="form-group">
                <label>Bores Sharing Pit</label>
                <input type="number" className="form-control"
                  value={form.hddBoresPerPit ?? 1} min={1} step={1}
                  onChange={(e) => {
                    const newBores = Math.max(1, parseInt(e.target.value) || 1);
                    onChange('hddBoresPerPit', newBores);
                    
                    const newList = [...additionalPipes];
                    const targetLen = newBores - 1;
                    if (newList.length < targetLen) {
                      for (let i = newList.length; i < targetLen; i++) {
                        newList.push({ pipeSizeIn: form.pipeSizeIn || (isMetric ? 90 : 3.0), pipeMaterialId: form.pipeMaterialId || null });
                      }
                    } else if (newList.length > targetLen) {
                      newList.splice(targetLen);
                    }
                    onChange('hddAdditionalPipesJson', JSON.stringify(newList));
                  }} />
              </div>
            </div>
          )}

          {isHDD && additionalPipes.map((p, idx) => (
            <div key={idx} className="form-row" style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: 13 }}>
                Bore {idx + 2} Details:
              </div>
              <div className="form-group">
                <label>Pipe Material</label>
                <select className="form-control"
                  value={p.pipeMaterialId || ''}
                  onChange={(e) => onChangeAdditionalPipe(idx, 'pipeMaterialId', parseInt(e.target.value) || null)}>
                  <option value="">Select material...</option>
                  {pipeMaterials.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Standard Pipe Size</label>
                <select className="form-control"
                  value={standardSizes.includes(p.pipeSizeIn) ? p.pipeSizeIn : 'custom'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val !== 'custom') {
                      onChangeAdditionalPipe(idx, 'pipeSizeIn', parseFloat(val));
                    }
                  }}>
                  {standardSizes.map((s) => (
                    <option key={s} value={s}>{isMetric ? `DN${s}` : `${s}"`}</option>
                  ))}
                  <option value="custom">Custom size...</option>
                </select>
              </div>
              <div className="form-group">
                <label>Pipe Size ({isMetric ? 'mm' : 'inches'})</label>
                <input type="number" className="form-control"
                  value={p.pipeSizeIn}
                  onChange={(e) => onChangeAdditionalPipe(idx, 'pipeSizeIn', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          ))}
        </>
      )}

      {errors.length > 0 && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.1)',
          borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>
          {errors.map((e, i) => <div key={i}>{e.message}</div>)}
        </div>
      )}

      {!isHDD && depthZones.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <label>Depth Summary</label>
          <DepthZoneTable zones={depthZones} />
        </div>
      )}

      {isHDD && hddOutput && (
        <div style={{ marginTop: 12, padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 6 }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>HDD Bore Estimate Summary</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <span className="text-muted" style={{ fontSize: 11, display: 'block' }}>Estimated Rate</span>
              <strong style={{ fontSize: 16 }}>{formatCurrency(hddOutput.summary.ratePerUnit)} / {isMetric ? 'm' : 'LF'}</strong>
            </div>
            <div>
              <span className="text-muted" style={{ fontSize: 11, display: 'block' }}>Total Estimate</span>
              <strong style={{ fontSize: 16 }}>{formatCurrency(hddOutput.summary.totalEstimate)}</strong>
            </div>
            <div>
              <span className="text-muted" style={{ fontSize: 11, display: 'block' }}>Duration</span>
              <strong style={{ fontSize: 16 }}>{hddOutput.summary.durationDays} day{hddOutput.summary.durationDays !== 1 ? 's' : ''}</strong>
            </div>
          </div>

          <label style={{ fontWeight: 600, display: 'block', marginBottom: 4, fontSize: 12 }}>Cost Category Breakdown</label>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Estimate (with Margin)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Establishment Fee</td>
                <td className="text-right">{formatCurrency(hddOutput.breakdown.establishment)}</td>
              </tr>
              <tr>
                <td>Crew & Rig Spread</td>
                <td className="text-right">{formatCurrency(hddOutput.breakdown.crewAndRigSpread)}</td>
              </tr>
              <tr>
                <td>Drilling Fluids</td>
                <td className="text-right">{formatCurrency(hddOutput.breakdown.drillingFluids)}</td>
              </tr>
              {form.hddIncludeSlurry !== false && (
                <tr>
                  <td>Slurry Disposal</td>
                  <td className="text-right">{formatCurrency(hddOutput.breakdown.slurryDisposal)}</td>
                </tr>
              )}
              {form.hddIncludePits !== false && (
                <tr>
                  <td>Excavator & Pits Allowance</td>
                  <td className="text-right">{formatCurrency(hddOutput.breakdown.excavatorAllowance)}</td>
                </tr>
              )}
              <tr style={{ fontWeight: 600 }}>
                <td>Total (including {form.hddMarginPct ?? 15}% margin)</td>
                <td className="text-right">{formatCurrency(hddOutput.summary.totalEstimate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!isHDD && takeoffRuns.length > 0 && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Preview against plan run</label>
          <select
            className="form-control"
            value={linkedRunId ?? ''}
            onChange={(e) => setLinkedRunId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— synthetic preview from the numbers above —</option>
            {takeoffRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || `Run ${r.id}`} · {formatPipeSize(r.pipeSizeIn, system)} {r.pipeMaterial || ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {(errors.length === 0 || linkedRun) && (() => {
        const groundSampler = linkedRun ? buildGroundSampler(surface, linkedRun.pdfPage) : undefined;
        const synthesizedRun = trenchInputToTakeoffRun({
          ...form,
          pipeSizeIn: isHDD && isMetric ? form.pipeSizeIn / 25.4 : form.pipeSizeIn,
          startDepthFt: form.startDepthFt || (isHDD ? 5 : 0),
          hddAdditionalPipesJson: form.hddAdditionalPipesJson || null,
        } as any, form.label);
        const run = linkedRun ?? synthesizedRun;
        const scalePxPerFt = linkedRun ? (pageScales[linkedRun.pdfPage] || TRENCH_PREVIEW_SCALE_PX_PER_FT) : TRENCH_PREVIEW_SCALE_PX_PER_FT;
        return (
          <div style={{ marginTop: 12 }}>
            {linkedRun && (
              <p className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
                Showing &quot;{linkedRun.label || `Run ${linkedRun.id}`}&quot; as drawn on the plan
                {groundSampler ? ', grounded to surveyed terrain' : ''} — not the numbers above.
              </p>
            )}
            <React.Suspense fallback={<p className="text-muted" style={{ padding: 24 }}>Loading 3D view…</p>}>
              <Trench3DView
                run={run}
                scalePxPerFt={scalePxPerFt}
                groundSampler={groundSampler}
                height={360}
                isHDD={isHDD}
                includePits={form.hddIncludePits !== false}
              />
            </React.Suspense>
          </div>
        );
      })()}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={errors.length > 0}>Save</button>
      </div>
    </div>
  );
}
