import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  calculateTrench, validateInput,
  type TrenchInput, type BeddingKey,
} from '../../modules/underground/trenchCalc';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TrenchProfileForm } from './TrenchProfileForm';

interface Props {
  jobId: number;
}

const DEFAULTS = {
  label: '',
  pipeSizeIn: 8,
  pipeMaterial: 'PVC',
  startDepthFt: 4,
  gradePct: 2.0,
  runLengthLF: 100,
  trenchWidthFt: 3,
  benchWidthFt: 0,
  beddingType: 'crushed_stone' as BeddingKey,
  backfillType: 'Native Material',
};

function rowToInput(row: any): TrenchInput {
  return {
    pipeSizeIn: row.pipe_size_in,
    pipeMaterial: row.pipe_material,
    startDepthFt: row.start_depth_ft,
    gradePct: row.grade_pct,
    runLengthLF: row.run_length_lf,
    trenchWidthFt: row.trench_width_ft,
    benchWidthFt: row.bench_width_ft,
    beddingType: row.bedding_type as BeddingKey,
    backfillType: row.backfill_type,
  };
}

export function TrenchProfileList({ jobId }: Props) {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...DEFAULTS });
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const loadProfiles = useCallback(async () => {
    const rows = await window.api.getTrenchProfiles(jobId);
    setProfiles(rows);
  }, [jobId]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const computed = useMemo(() => {
    return profiles.map((row) => {
      const input = rowToInput(row);
      const errors = validateInput(input);
      return errors.length === 0 ? calculateTrench(input) : null;
    });
  }, [profiles]);

  const totals = useMemo(() => {
    const t = { pipeLF: 0, excavationCY: 0, beddingTons: 0, backfillCY: 0, tracerWireLF: 0, warningTapeLF: 0 };
    for (const out of computed) {
      if (!out) continue;
      t.pipeLF += out.pipeLF;
      t.excavationCY += out.excavationCY;
      t.beddingTons += out.beddingTons;
      t.backfillCY += out.backfillCY;
      t.tracerWireLF += out.tracerWireLF;
      t.warningTapeLF += out.warningTapeLF;
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
    beddingType: form.beddingType,
    backfillType: form.backfillType,
  };
  const formErrors = editingId !== null ? validateInput(formInput) : [];

  const addNew = async () => {
    const maxSort = profiles.reduce((m: number, p: any) => Math.max(m, p.sort_order ?? 0), 0);
    const result = await window.api.saveTrenchProfile({
      jobId,
      ...DEFAULTS,
      sortOrder: maxSort + 1,
    });
    await loadProfiles();
    setForm({ ...DEFAULTS });
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
      beddingType: row.bedding_type as BeddingKey,
      backfillType: row.backfill_type,
    });
    setEditingId(row.id);
  };

  const saveProfile = async () => {
    if (editingId === null) return;
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
      beddingType: form.beddingType,
      backfillType: form.backfillType,
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

  const r2 = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="card mb-24">
      <div className="flex justify-between items-center mb-16">
        <h3 style={{ fontSize: 15 }}>Trench Profiles</h3>
        <button className="btn btn-sm btn-primary no-print" onClick={addNew}>+ Profile</button>
      </div>

      {profiles.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13 }}>No trench profiles. Click "+ Profile" to add one.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th className="text-right">Pipe (LF)</th>
              <th className="text-right">Size/Material</th>
              <th className="text-right">Avg Depth (ft)</th>
              <th className="text-right">Excavation (CY)</th>
              <th className="text-right">Bedding (tons)</th>
              <th className="text-right">Backfill (CY)</th>
              <th className="no-print" style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((row, idx) => {
              const out = computed[idx];
              return (
                <React.Fragment key={row.id}>
                  <tr>
                    <td>
                      <span className="material-name-link no-print" onClick={() => startEdit(row)}>
                        {row.label || `Run ${idx + 1}`}
                      </span>
                      <span className="print-only">{row.label || `Run ${idx + 1}`}</span>
                    </td>
                    <td className="text-right">{out?.pipeLF ?? '--'}</td>
                    <td className="text-right">{row.pipe_size_in}" {row.pipe_material}</td>
                    <td className="text-right">{out?.avgDepthFt ?? '--'}</td>
                    <td className="text-right">{out?.excavationCY ?? '--'}</td>
                    <td className="text-right">{out?.beddingTons ?? '--'}</td>
                    <td className="text-right">{out?.backfillCY ?? '--'}</td>
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
                        onSave={saveProfile} onCancel={() => setEditingId(null)} errors={formErrors} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
            <tr>
              <td style={{ fontWeight: 600 }}>Totals</td>
              <td className="text-right" style={{ fontWeight: 600 }}>{r2(totals.pipeLF)}</td>
              <td></td>
              <td></td>
              <td className="text-right" style={{ fontWeight: 600 }}>{r2(totals.excavationCY)}</td>
              <td className="text-right" style={{ fontWeight: 600 }}>{r2(totals.beddingTons)}</td>
              <td className="text-right" style={{ fontWeight: 600 }}>{r2(totals.backfillCY)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      )}

      {profiles.length > 0 && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Tracer Wire: {r2(totals.tracerWireLF)} LF | Warning Tape: {r2(totals.warningTapeLF)} LF
        </div>
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} yesLabel="Delete" variant="danger" />
      )}
    </div>
  );
}
