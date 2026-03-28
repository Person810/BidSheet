import React, { useState, useMemo } from 'react';
import {
  PIPE_SIZES, PIPE_MATERIALS, BEDDING_TYPES, BACKFILL_TYPES,
  calculateTrench, validateInput,
  type TrenchInput, type BeddingKey,
} from './trenchCalc';

const DEFAULTS: TrenchInput = {
  pipeSizeIn: 8,
  pipeMaterial: 'PVC',
  startDepthFt: 4,
  gradePct: 2.0,
  runLengthLF: 100,
  trenchWidthFt: 3,
  benchWidthFt: 0,
  beddingType: 'crushed_stone',
  backfillType: 'Native Material',
};

export function TrenchProfiler() {
  const [input, setInput] = useState<TrenchInput>({ ...DEFAULTS });

  const set = <K extends keyof TrenchInput>(field: K, value: TrenchInput[K]) =>
    setInput((prev) => ({ ...prev, [field]: value }));

  const errors = useMemo(() => validateInput(input), [input]);
  const result = useMemo(() => (errors.length === 0 ? calculateTrench(input) : null), [input, errors]);

  const hasError = (field: string) => errors.some((e) => e.field === field);

  const handleReset = () => setInput({ ...DEFAULTS });

  return (
    <div>
      <div className="page-header">
        <h2>Trench Profiler</h2>
        <button className="btn btn-secondary" onClick={handleReset}>Reset</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        {/* ---- Inputs ---- */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>Run Inputs</h3>

          <div className="form-row">
            <div className="form-group">
              <label>Pipe Size (in)</label>
              <select className="form-control" value={input.pipeSizeIn}
                onChange={(e) => set('pipeSizeIn', Number(e.target.value))}>
                {PIPE_SIZES.map((s) => <option key={s} value={s}>{s}"</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Pipe Material</label>
              <select className="form-control" value={input.pipeMaterial}
                onChange={(e) => set('pipeMaterial', e.target.value)}>
                {PIPE_MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Starting Invert Depth (ft)</label>
              <input type="number" className={`form-control ${hasError('startDepthFt') ? 'input-error' : ''}`}
                value={input.startDepthFt} step="0.5" min="0"
                onChange={(e) => set('startDepthFt', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Grade / Slope (%)</label>
              <input type="number" className={`form-control ${hasError('gradePct') ? 'input-error' : ''}`}
                value={input.gradePct} step="0.1" min="0"
                onChange={(e) => set('gradePct', parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="form-group">
            <label>Horizontal Run Length (LF)</label>
            <input type="number" className={`form-control ${hasError('runLengthLF') ? 'input-error' : ''}`}
              value={input.runLengthLF} step="1" min="0"
              onChange={(e) => set('runLengthLF', parseFloat(e.target.value) || 0)} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Trench Width (ft)</label>
              <input type="number" className={`form-control ${hasError('trenchWidthFt') ? 'input-error' : ''}`}
                value={input.trenchWidthFt} step="0.5" min="0"
                onChange={(e) => set('trenchWidthFt', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Bench Width Each Side (ft)</label>
              <input type="number" className={`form-control ${hasError('benchWidthFt') ? 'input-error' : ''}`}
                value={input.benchWidthFt} step="0.5" min="0"
                onChange={(e) => set('benchWidthFt', parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Bedding Type</label>
              <select className="form-control" value={input.beddingType}
                onChange={(e) => set('beddingType', e.target.value as BeddingKey)}>
                {Object.entries(BEDDING_TYPES).map(([key, b]) => (
                  <option key={key} value={key}>{b.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Backfill Type</label>
              <select className="form-control" value={input.backfillType}
                onChange={(e) => set('backfillType', e.target.value)}>
                {BACKFILL_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          {errors.length > 0 && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)',
              borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>
              {errors.map((e, i) => <div key={i}>{e.message}</div>)}
            </div>
          )}
        </div>

        {/* ---- Outputs ---- */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>Takeoff Summary</h3>
          {result ? (
            <table className="data-table" style={{ fontSize: 13 }}>
              <tbody>
                <Row label="Pipe" value={`${result.pipeLF} LF`} sub={`${input.pipeSizeIn}" ${input.pipeMaterial}`} />
                <Row label="Avg Trench Depth" value={`${result.avgDepthFt} ft`}
                  sub={`${input.startDepthFt}' start \u2192 ${result.endDepthFt}' end`} />
                <Row label="Excavation" value={`${result.excavationCY} CY`} />
                <Row label="Bedding" value={`${result.beddingTons} tons`}
                  sub={`${result.beddingCY} CY ${BEDDING_TYPES[input.beddingType].label}`} />
                <Row label="Backfill" value={`${result.backfillCY} CY`} sub={input.backfillType} />
                <Row label="Tracer Wire" value={`${result.tracerWireLF} LF`} />
                <Row label="Warning Tape" value={`${result.warningTapeLF} LF`} />
              </tbody>
            </table>
          ) : (
            <p className="text-muted" style={{ padding: 24, textAlign: 'center' }}>
              Fix input errors to see results.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* Small helper -- keeps the output table consistent */
function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <tr>
      <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</td>
      <td className="text-right" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{value}</td>
      {sub !== undefined && (
        <td className="text-muted" style={{ fontSize: 12, paddingLeft: 8 }}>{sub}</td>
      )}
    </tr>
  );
}
