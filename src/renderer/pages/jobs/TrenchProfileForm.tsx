import React from 'react';
import {
  PIPE_SIZES, PIPE_MATERIALS, BEDDING_TYPES, BACKFILL_TYPES,
  type TrenchInput, type BeddingKey, type ValidationError,
} from '../../modules/underground/trenchCalc';

interface FormData extends TrenchInput {
  label: string;
}

interface Props {
  form: FormData;
  onChange: (field: string, value: any) => void;
  onSave: () => void;
  onCancel: () => void;
  errors: ValidationError[];
}

export function TrenchProfileForm({ form, onChange, onSave, onCancel, errors }: Props) {
  const hasError = (field: string) => errors.some((e) => e.field === field);

  return (
    <div style={{ padding: '12px 0' }}>
      <div className="form-row">
        <div className="form-group" style={{ flex: 2 }}>
          <label>Label</label>
          <input type="text" className="form-control" placeholder="e.g. MH-1 to MH-2"
            value={form.label} onChange={(e) => onChange('label', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Pipe Size (in)</label>
          <select className="form-control" value={form.pipeSizeIn}
            onChange={(e) => onChange('pipeSizeIn', Number(e.target.value))}>
            {PIPE_SIZES.map((s) => <option key={s} value={s}>{s}"</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Pipe Material</label>
          <select className="form-control" value={form.pipeMaterial}
            onChange={(e) => onChange('pipeMaterial', e.target.value)}>
            {PIPE_MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Start Depth (ft)</label>
          <input type="number" className={`form-control ${hasError('startDepthFt') ? 'input-error' : ''}`}
            value={form.startDepthFt} step="0.5" min="0"
            onChange={(e) => onChange('startDepthFt', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="form-group">
          <label>Grade (%)</label>
          <input type="number" className={`form-control ${hasError('gradePct') ? 'input-error' : ''}`}
            value={form.gradePct} step="0.1" min="0"
            onChange={(e) => onChange('gradePct', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="form-group">
          <label>Run Length (LF)</label>
          <input type="number" className={`form-control ${hasError('runLengthLF') ? 'input-error' : ''}`}
            value={form.runLengthLF} step="1" min="0"
            onChange={(e) => onChange('runLengthLF', parseFloat(e.target.value) || 0)} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Trench Width (ft)</label>
          <input type="number" className={`form-control ${hasError('trenchWidthFt') ? 'input-error' : ''}`}
            value={form.trenchWidthFt} step="0.5" min="0"
            onChange={(e) => onChange('trenchWidthFt', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="form-group">
          <label>Bench Width (ft)</label>
          <input type="number" className={`form-control ${hasError('benchWidthFt') ? 'input-error' : ''}`}
            value={form.benchWidthFt} step="0.5" min="0"
            onChange={(e) => onChange('benchWidthFt', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="form-group">
          <label>Bedding Type</label>
          <select className="form-control" value={form.beddingType}
            onChange={(e) => onChange('beddingType', e.target.value as BeddingKey)}>
            {Object.entries(BEDDING_TYPES).map(([key, b]) => (
              <option key={key} value={key}>{b.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Backfill Type</label>
          <select className="form-control" value={form.backfillType}
            onChange={(e) => onChange('backfillType', e.target.value)}>
            {BACKFILL_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {errors.length > 0 && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.1)',
          borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>
          {errors.map((e, i) => <div key={i}>{e.message}</div>)}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={errors.length > 0}>Save</button>
      </div>
    </div>
  );
}
