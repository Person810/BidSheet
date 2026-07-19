import React, { useMemo, useState } from 'react';
import {
  parsePipeSizeFromName, depthZoneBreakdown,
  type TrenchInput, type ValidationError,
} from '../../modules/underground/trenchCalc';
import { FuzzyAutocomplete, type AutocompleteItem } from '../../components/FuzzyAutocomplete';
import { NATIVE_MATERIAL_ITEM } from '../../modules/underground/useTrenchMaterials';
import { trenchInputToTakeoffRun, TRENCH_PREVIEW_SCALE_PX_PER_FT } from '../../modules/underground/trenchInputToRun';
import { buildGroundSampler } from '../../modules/underground/plan-takeoff/surfaceSampler';
import type { TakeoffRun, TakeoffSurface } from '../../modules/underground/plan-takeoff/types';
import { DepthZoneTable } from '../../modules/underground/DepthZoneTable';
import { UnitInput } from '../../components/UnitInput';
import { useUnitSystem } from '../../stores/units-store';
import { unitLabel, formatPipeSize } from '../../../shared/unitSystem';

const Trench3DView = React.lazy(() =>
  import('../../modules/underground/plan-takeoff/Trench3DView').then((m) => ({ default: m.Trench3DView })));

interface FormData extends TrenchInput {
  label: string;
  pipeMaterialId: number | string | null;
  beddingMaterialId: number | string | null;
  backfillMaterialId: number | string | null;
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
}

export function TrenchProfileForm({
  form, onChange, onSave, onCancel, errors, pipeMaterials, beddingMaterials,
  takeoffRuns, pageScales, surface,
}: Props) {
  const system = useUnitSystem();
  const hasError = (field: string) => errors.some((e) => e.field === field);
  const [linkedRunId, setLinkedRunId] = useState<number | null>(null);
  const linkedRun = takeoffRuns.find((r) => r.id === linkedRunId) ?? null;
  const depthZones = useMemo(
    () => (errors.length === 0 ? depthZoneBreakdown(form) : []),
    [form, errors]
  );

  const backfillItems = useMemo(
    () => [NATIVE_MATERIAL_ITEM, ...beddingMaterials],
    [beddingMaterials]
  );

  const selectedPipe = pipeMaterials.find((m) => m.id === form.pipeMaterialId);
  const selectedBedding = beddingMaterials.find((m) => m.id === form.beddingMaterialId);

  return (
    <div style={{ padding: '12px 0' }}>
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
      </div>

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

      {errors.length > 0 && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.1)',
          borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>
          {errors.map((e, i) => <div key={i}>{e.message}</div>)}
        </div>
      )}

      {depthZones.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <label>Depth Summary</label>
          <DepthZoneTable zones={depthZones} />
        </div>
      )}

      {takeoffRuns.length > 0 && (
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
        const run = linkedRun ?? trenchInputToTakeoffRun(form, form.label);
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
