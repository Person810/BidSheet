import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  calculateTrench, validateInput,
  type TrenchInput,
} from '../../modules/underground/trenchCalc';
import { calculateHDD, validateHDDInput } from '../../modules/underground/hddCalc';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TrenchProfileForm } from './TrenchProfileForm';
import { useTrenchMaterials } from '../../modules/underground/useTrenchMaterials';
import { useSurfaceManager } from '../../modules/underground/plan-takeoff/useSurfaceManager';
import type { TakeoffRun } from '../../modules/underground/plan-takeoff/types';
import { useUnitSystem } from '../../stores/units-store';
import { unitLabel, convertQty, formatPipeSize, fromDisplay } from '../../../shared/unitSystem';
import { formatCurrency } from './helpers';

export interface ConvertToBidProfile {
  label: string;
  pipeLF: number;
  excavationCY: number;
  beddingCY: number;
  backfillCY: number;
  tracerWireLF: number;
  warningTapeLF: number;
  pipeMaterialId: number | null;
  pipeMaterialName: string;
  beddingMaterialId: number | null;
  beddingMaterialName: string;
  beddingMaterialUnit: string;
  backfillMaterialId: number | null;
  backfillMaterialName: string;
  backfillMaterialUnit: string;
  method?: string;
  hddLocation?: string;
  hddIncludeSlurry?: boolean;
  hddIncludePits?: boolean;
  hddMarginPct?: number;
  totalEstimate?: number;
  additionalPipes?: Array<{ pipeLF: number; pipeMaterialId: number | null; pipeMaterialName: string }>;
}

interface Props {
  jobId: number;
  onConvertToBid?: (profileData: ConvertToBidProfile[]) => Promise<void>;
  onProfileCountChange?: (count: number) => void;
}

const DEFAULTS = {
  label: '',
  pipeSizeIn: 8,
  pipeMaterial: '',
  startDepthFt: 4,
  gradePct: 2.0,
  runLengthLF: 100,
  trenchWidthFt: 3,
  benchWidthFt: 0,
  beddingDepthFt: 0.5,
  backfillType: 'Native Material',
  compactionPct: 0,
  pipeMaterialId: null as number | string | null,
  beddingMaterialId: null as number | string | null,
  backfillMaterialId: 'native' as number | string | null,
  method: 'open_cut',
  hddLocation: 'metro',
  hddIncludeSlurry: true,
  hddIncludePits: true,
  hddMarginPct: 15,
  hddBoresPerPit: 1,
  hddAdditionalPipesJson: '',
};

/** Metric prefills: round metres (1.2 m deep, 30 m long, 1 m wide, 150 mm
 *  bedding) instead of converted feet. */
const METRIC_DEFAULTS = {
  ...DEFAULTS,
  startDepthFt: fromDisplay(1.2, 'ft', 'metric'),
  runLengthLF: fromDisplay(30, 'lf', 'metric'),
  trenchWidthFt: fromDisplay(1, 'ft', 'metric'),
  beddingDepthFt: fromDisplay(0.15, 'ft', 'metric'),
};

function rowToInput(row: any): TrenchInput {
  let additionalPipes: any[] = [];
  const jsonStr = row.hdd_additional_pipes_json || (row.backfill_type && row.backfill_type.startsWith('[') ? row.backfill_type : '');
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        additionalPipes = parsed.map((p: any) => ({
          pipeSizeIn: p.pipeSizeIn || 0,
          pipeMaterial: p.pipeMaterial || '',
        }));
      }
    } catch {}
  }
  return {
    pipeSizeIn: row.pipe_size_in,
    pipeMaterial: row.pipe_material,
    additionalPipes,
    startDepthFt: row.start_depth_ft,
    gradePct: row.grade_pct,
    runLengthLF: row.run_length_lf,
    trenchWidthFt: row.trench_width_ft,
    benchWidthFt: row.bench_width_ft,
    beddingDepthFt: row.bedding_depth_ft ?? 0.5,
    backfillType: row.backfill_type,
    compactionPct: row.compaction_pct ?? 0,
  };
}

export function TrenchProfileList({ jobId, onConvertToBid, onProfileCountChange }: Props) {
  const system = useUnitSystem();
  const defaults = system === 'metric' ? METRIC_DEFAULTS : DEFAULTS;
  const [profiles, setProfiles] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...defaults });
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void; yesLabel?: string; variant?: 'danger' | 'neutral' } | null>(null);

  const { pipeMaterials, beddingMaterials } = useTrenchMaterials();

  // Plan Takeoff data (runs + terrain), so the 3D preview can show a profile
  // against the real pipe route and surveyed ground instead of a synthetic
  // straight line -- read-only here, this tab never edits takeoff data.
  const [takeoffRuns, setTakeoffRuns] = useState<TakeoffRun[]>([]);
  const [pageScales, setPageScales] = useState<Record<number, number>>({});
  const { surface } = useSurfaceManager({ jobId });

  useEffect(() => {
    window.api.listTakeoffRuns(jobId).then(setTakeoffRuns);
    window.api.listPageScales(jobId).then((rows: { page_number: number; scale_px_per_ft: number }[]) => {
      const map: Record<number, number> = {};
      rows.forEach((r) => { map[r.page_number] = r.scale_px_per_ft; });
      setPageScales(map);
    });
    window.api.getSettings().then(setSettings);
  }, [jobId]);

  const loadProfiles = useCallback(async () => {
    const rows = await window.api.getTrenchProfiles(jobId);
    setProfiles(rows);
    onProfileCountChange?.(rows.length);
  }, [jobId, onProfileCountChange]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const computed = useMemo(() => {
    const customRates = settings?.hdd_rates_json ? JSON.parse(settings.hdd_rates_json) : undefined;
    return profiles.map((row) => {
      const isHDD = row.method === 'hdd';
      if (isHDD) {
        const errors = validateHDDInput({
          pipeSizeIn: row.pipe_size_in,
          runLengthLF: row.run_length_lf,
          hddMarginPct: row.hdd_margin_pct,
        });
        if (errors.length > 0) return null;
        try {
          let additionalPipes: Array<{ pipeSizeIn: number; pipeMaterialId: number | string | null }> = [];
          const jsonStr = row.hdd_additional_pipes_json || (row.backfill_type && row.backfill_type.startsWith('[') ? row.backfill_type : '');
          if (jsonStr) {
            try {
              additionalPipes = JSON.parse(jsonStr);
            } catch {}
          }
          const calc = calculateHDD({
            location: row.hdd_location || 'metro',
            dn: row.pipe_size_in,
            length: row.run_length_lf,
            includeSlurry: row.backfill_type !== 'bundle' && row.hdd_include_slurry !== 0,
            includePits: row.backfill_type !== 'bundle' && row.hdd_include_pits !== 0,
            marginPct: row.hdd_margin_pct ?? 15,
            locale: system === 'metric' ? 'en-AU' : 'en-US',
            boresPerPit: row.hdd_bores_per_pit !== undefined && row.hdd_bores_per_pit !== null ? row.hdd_bores_per_pit : (row.compaction_pct || 1),
            isBundle: row.backfill_type === 'bundle',
            additionalPipes,
            customRates,
          });
          return {
            method: 'hdd',
            pipeLF: row.run_length_lf,
            excavationCY: 0,
            beddingCY: 0,
            backfillCY: 0,
            tracerWireLF: 0,
            warningTapeLF: 0,
            avgDepthFt: 0,
            totalEstimate: calc.summary.totalEstimate,
          };
        } catch {
          return null;
        }
      } else {
        const input = rowToInput(row);
        const errors = validateInput(input);
        return errors.length === 0 ? calculateTrench(input) : null;
      }
    }) as any[];
  }, [profiles, system, settings]);

  const totals = useMemo(() => {
    const t = { pipeLF: 0, excavationCY: 0, beddingCY: 0, backfillCY: 0, tracerWireLF: 0, warningTapeLF: 0, hddTotal: 0 };
    for (const out of computed) {
      if (!out) continue;
      t.pipeLF += out.pipeLF;
      if (out.method === 'hdd') {
        t.hddTotal += (out as any).totalEstimate || 0;
      } else {
        t.excavationCY += out.excavationCY;
        t.beddingCY += out.beddingCY;
        t.backfillCY += out.backfillCY;
        t.tracerWireLF += out.tracerWireLF;
        t.warningTapeLF += out.warningTapeLF;
      }
    }
    return t;
  }, [computed]);

  const handleChange = (field: string, value: any) => setForm((prev) => ({ ...prev, [field]: value }));

  const formInput: TrenchInput = {
    pipeSizeIn: form.pipeSizeIn,
    pipeMaterial: form.pipeMaterial,
    startDepthFt: form.startDepthFt,
    gradePct: form.gradePct,
    runLengthLF: form.runLengthLF,
    trenchWidthFt: form.trenchWidthFt,
    benchWidthFt: form.benchWidthFt,
    beddingDepthFt: form.beddingDepthFt,
    backfillType: form.backfillType,
    compactionPct: form.compactionPct,
  };
  const formErrors = editingId !== null ? (
    form.method === 'hdd' ? validateHDDInput({
      pipeSizeIn: form.pipeSizeIn,
      runLengthLF: form.runLengthLF,
      hddMarginPct: form.hddMarginPct,
    }) : validateInput(formInput)
  ) : [];

  const addNew = async () => {
    const maxSort = profiles.reduce((m: number, p: any) => Math.max(m, p.sort_order ?? 0), 0);
    const result = await window.api.saveTrenchProfile({
      jobId,
      ...defaults,
      sortOrder: maxSort + 1,
      method: 'open_cut',
      hddLocation: 'metro',
      hddIncludeSlurry: true,
      hddIncludePits: true,
      hddMarginPct: 15,
    });
    await loadProfiles();
    setForm({
      ...defaults,
      method: 'open_cut',
      hddLocation: 'metro',
      hddIncludeSlurry: true,
      hddIncludePits: true,
      hddMarginPct: 15,
    });
    setEditingId(result.id);
  };

  const startEdit = (row: any) => {
    setForm({
      label: row.label || '',
      pipeSizeIn: row.pipe_size_in,
      pipeMaterial: row.pipe_material,
      startDepthFt: row.start_depth_ft,
      gradePct: row.grade_pct,
      runLengthLF: row.run_length_lf,
      trenchWidthFt: row.trench_width_ft,
      benchWidthFt: row.bench_width_ft,
      beddingDepthFt: row.bedding_depth_ft ?? 0.5,
      backfillType: row.backfill_type,
      compactionPct: row.compaction_pct ?? 0,
      pipeMaterialId: row.pipe_material_id ?? null,
      beddingMaterialId: row.bedding_material_id ?? null,
      backfillMaterialId: row.backfill_material_id ?? (row.backfill_type === 'Native Material' ? 'native' : null),
      method: row.method || 'open_cut',
      hddLocation: row.hdd_location || 'metro',
      hddIncludeSlurry: row.hdd_include_slurry !== 0,
      hddIncludePits: row.hdd_include_pits !== 0,
      hddMarginPct: row.hdd_margin_pct ?? 15,
      hddBoresPerPit: row.hdd_bores_per_pit !== undefined && row.hdd_bores_per_pit !== null ? row.hdd_bores_per_pit : (row.compaction_pct || 1),
      hddAdditionalPipesJson: row.hdd_additional_pipes_json || (row.backfill_type && row.backfill_type.startsWith('[') ? row.backfill_type : ''),
    });
    setEditingId(row.id);
  };

  const saveProfile = async () => {
    if (editingId === null) return;

    // Derive text labels for backward compat storage
    const beddingLabel = beddingMaterials.find((m) => m.id === form.beddingMaterialId)?.label || '';
    const backfillLabel = form.backfillType || '';

    // If method is open_cut, clear/ignore the HDD specific columns
    const isHDD = form.method === 'hdd';

    await window.api.saveTrenchProfile({
      id: editingId,
      jobId,
      label: form.label,
      pipeSizeIn: form.pipeSizeIn,
      pipeMaterial: form.pipeMaterial,
      startDepthFt: form.startDepthFt,
      gradePct: form.gradePct,
      runLengthLF: form.runLengthLF,
      trenchWidthFt: form.trenchWidthFt,
      benchWidthFt: form.benchWidthFt,
      beddingType: beddingLabel,
      backfillType: isHDD ? null : backfillLabel,
      beddingDepthFt: form.beddingDepthFt,
      compactionPct: isHDD ? 0 : form.compactionPct,
      pipeMaterialId: typeof form.pipeMaterialId === 'number' ? form.pipeMaterialId : null,
      beddingMaterialId: typeof form.beddingMaterialId === 'number' ? form.beddingMaterialId : null,
      backfillMaterialId: typeof form.backfillMaterialId === 'number' ? form.backfillMaterialId : null,
      method: form.method || 'open_cut',
      hddLocation: form.hddLocation || 'metro',
      hddIncludeSlurry: form.hddIncludeSlurry !== false,
      hddIncludePits: form.hddIncludePits !== false,
      hddMarginPct: form.hddMarginPct ?? 15,
      hddBoresPerPit: isHDD ? ((form as any).hddBoresPerPit ?? 1) : 1,
      hddAdditionalPipesJson: isHDD ? ((form as any).hddAdditionalPipesJson || null) : null,
    });
    setEditingId(null);
    await loadProfiles();
  };

  const confirmDelete = (id: number) => {
    setConfirmState({
      msg: 'Delete this trench profile?',
      onYes: async () => {
        await window.api.deleteTrenchProfile(id);
        setConfirmState(null);
        if (editingId === id) setEditingId(null);
        await loadProfiles();
      },
    });
  };

  // Display-boundary conversion (#97): rows stay canonical; metric mode
  // converts each rendered number. r2 doubles as the imperial no-op.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lf = (n: number) => r2(convertQty(n, 'lf', system));
  const cy = (n: number) => r2(convertQty(n, 'cy', system));

  const pipeDisplay = (row: any) => {
    if (row.method === 'hdd') {
      return system === 'metric' ? `DN${row.pipe_size_in} (HDD)` : `${row.pipe_size_in}" (HDD)`;
    }
    if (row.pipe_material_id) {
      const mat = pipeMaterials.find((m) => m.id === row.pipe_material_id);
      if (mat) return mat.label;
    }
    return `${formatPipeSize(row.pipe_size_in, system)} ${row.pipe_material}`;
  };

  const hasValidProfiles = computed.some((c) => c !== null);

  const handleConvert = () => {
    if (!onConvertToBid) return;
    setConfirmState({
      msg: 'Create bid sections from trench profiles? This will add new sections and line items for pipe, excavation, bedding, backfill, tracer wire, and warning tape. Existing sections are not affected.',
      yesLabel: 'Create Sections',
      variant: 'neutral',
      onYes: async () => {
        setConfirmState(null);
        const data: ConvertToBidProfile[] = [];
        profiles.forEach((row, idx) => {
          const out = computed[idx];
          if (!out) return;
          const pipeMat = pipeMaterials.find((m) => m.id === row.pipe_material_id);
          const beddingMat = beddingMaterials.find((m) => m.id === row.bedding_material_id);
          const backfillMat = beddingMaterials.find((m) => m.id === row.backfill_material_id);
          let additionalPipes: Array<{ pipeLF: number; pipeMaterialId: number | null; pipeMaterialName: string }> = [];
          if (row.method === 'hdd' && row.backfill_type && row.backfill_type.startsWith('[')) {
            try {
              const list = JSON.parse(row.backfill_type) as Array<{ pipeSizeIn: number; pipeMaterialId: number | string | null }>;
              additionalPipes = list.map((item) => {
                const mat = pipeMaterials.find((m) => m.id === item.pipeMaterialId);
                return {
                  pipeLF: row.run_length_lf,
                  pipeMaterialId: typeof item.pipeMaterialId === 'number' ? item.pipeMaterialId : null,
                  pipeMaterialName: mat?.label || 'Pipe',
                };
              });
            } catch {}
          }

          data.push({
            label: row.label || `Run ${idx + 1}`,
            pipeLF: out.pipeLF,
            excavationCY: out.excavationCY,
            beddingCY: out.beddingCY,
            backfillCY: out.backfillCY,
            tracerWireLF: out.tracerWireLF,
            warningTapeLF: out.warningTapeLF,
            pipeMaterialId: row.pipe_material_id ?? null,
            pipeMaterialName: pipeMat?.label || row.pipe_material || 'Pipe',
            beddingMaterialId: row.bedding_material_id ?? null,
            beddingMaterialName: beddingMat?.label || row.bedding_type || 'Bedding',
            beddingMaterialUnit: beddingMat?.detailSub || '',
            backfillMaterialId: row.backfill_material_id ?? null,
            backfillMaterialName: backfillMat?.label || row.backfill_type || 'Backfill',
            backfillMaterialUnit: backfillMat?.detailSub || '',
            method: row.method || 'open_cut',
            hddLocation: row.hdd_location || 'metro',
            hddIncludeSlurry: row.hdd_include_slurry !== 0,
            hddIncludePits: row.hdd_include_pits !== 0,
            hddMarginPct: row.hdd_margin_pct ?? 15,
            totalEstimate: (out as any).totalEstimate,
            additionalPipes: additionalPipes.length > 0 ? additionalPipes : undefined,
          });
        });
        await onConvertToBid(data);
      },
    });
  };

  return (
    <div>
      <div className="flex justify-between items-center" style={{ padding: '8px 8px 6px' }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
          {profiles.length > 0 && <> &middot; {lf(totals.pipeLF)} {unitLabel('lf', system)} total</>}
        </span>
        <div className="flex gap-8 no-print">
          {hasValidProfiles && onConvertToBid && (
            <button className="btn btn-sm btn-secondary" onClick={handleConvert}>Convert to Bid</button>
          )}
          <button className="btn btn-sm btn-primary" onClick={addNew}>+ Profile</button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13 }}>No trench profiles. Click "+ Profile" to add one.</p>
      ) : (
        <table className="bid-grid">
          <thead>
            <tr>
              <th>Label</th>
              <th className="text-right">Pipe ({unitLabel('lf', system)})</th>
              <th className="text-right">Size/Material</th>
              <th className="text-right">Avg Depth ({unitLabel('ft', system)})</th>
              <th className="text-right">Excavation ({unitLabel('cy', system)})</th>
              <th className="text-right">Bedding ({unitLabel('cy', system)})</th>
              <th className="text-right">Backfill ({unitLabel('cy', system)})</th>
              <th className="no-print" style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((row, idx) => {
              const out = computed[idx];
              const isHDD = row.method === 'hdd';
              return (
                <React.Fragment key={row.id}>
                  <tr>
                    <td>
                      <span className="material-name-link no-print" onClick={() => startEdit(row)}>
                        {row.label || `Run ${idx + 1}`}
                      </span>
                      <span className="print-only">{row.label || `Run ${idx + 1}`}</span>
                    </td>
                    <td className="text-right">{out ? lf(out.pipeLF) : '--'}</td>
                    <td className="text-right">{pipeDisplay(row)}</td>
                    {isHDD ? (
                      <td colSpan={4} className="text-right" style={{ fontWeight: 600, color: 'var(--accent)' }}>
                        HDD Estimate: {out ? formatCurrency((out as any).totalEstimate) : '--'}
                      </td>
                    ) : (
                      <>
                        <td className="text-right">{out ? r2(convertQty(out.avgDepthFt, 'ft', system)) : '--'}</td>
                        <td className="text-right">{out ? cy(out.excavationCY) : '--'}</td>
                        <td className="text-right">{out ? cy(out.beddingCY) : '--'}</td>
                        <td className="text-right">{out ? cy(out.backfillCY) : '--'}</td>
                      </>
                    )}
                    <td className="no-print">
                      <div className="flex gap-8">
                        <button className="btn btn-sm btn-secondary" onClick={() => startEdit(row)}>Edit</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => confirmDelete(row.id)}>&times;</button>
                      </div>
                    </td>
                  </tr>
                  {editingId === row.id && (
                    <tr><td colSpan={8} style={{ padding: 0 }}>
                      <TrenchProfileForm form={form} onChange={handleChange}
                        onSave={saveProfile} onCancel={() => setEditingId(null)} errors={formErrors}
                        pipeMaterials={pipeMaterials} beddingMaterials={beddingMaterials}
                        takeoffRuns={takeoffRuns} pageScales={pageScales} surface={surface}
                        customRates={settings?.hdd_rates_json ? JSON.parse(settings.hdd_rates_json) : undefined} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
            <tr>
              <td style={{ fontWeight: 600 }}>Totals</td>
              <td className="text-right" style={{ fontWeight: 600 }}>{lf(totals.pipeLF)}</td>
              <td></td>
              <td></td>
              <td className="text-right" style={{ fontWeight: 600 }}>{cy(totals.excavationCY)}</td>
              <td className="text-right" style={{ fontWeight: 600 }}>{cy(totals.beddingCY)}</td>
              <td className="text-right" style={{ fontWeight: 600 }}>{cy(totals.backfillCY)}</td>
              <td></td>
            </tr>
          </tbody>
          <tfoot className="bid-grid-footer">
            <tr>
              <td colSpan={8} className="text-muted" style={{ fontSize: 11 }}>
                {profiles.some((p) => (p.method || 'open_cut') !== 'hdd') && (
                  <>
                    Open-Cut: Tracer Wire: {lf(totals.tracerWireLF)} {unitLabel('lf', system)} &middot; Warning Tape: {lf(totals.warningTapeLF)} {unitLabel('lf', system)}
                    {totals.hddTotal > 0 && <> &middot; </>}
                  </>
                )}
                {totals.hddTotal > 0 && <>HDD Total: {formatCurrency(totals.hddTotal)}</>}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} yesLabel={confirmState.yesLabel || 'Delete'}
          variant={confirmState.variant || 'danger'} />
      )}
    </div>
  );
}
