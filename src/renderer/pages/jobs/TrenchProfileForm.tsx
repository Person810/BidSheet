import React, { useMemo } from 'react';
import {
  parsePipeSizeFromName,
  type TrenchInput, type ValidationError,
} from '../../modules/underground/trenchCalc';
import { FuzzyAutocomplete, type AutocompleteItem } from '../../components/FuzzyAutocomplete';
import { NATIVE_MATERIAL_ITEM } from '../../modules/underground/useTrenchMaterials';

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
}

export function TrenchProfileForm({ form, onChange, onSave, onCancel, errors, pipeMaterials, beddingMaterials }: Props) {
  const hasError = (field: string) => errors.some((e) => e.field === field);

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
          <label>Bedding Depth (ft)</label>
          <input type="number" className={`form-control ${hasError('beddingDepthFt') ? 'input-error' : ''}`}
            value={form.beddingDepthFt} step="0.25" min="0"
            onChange={(e) => onChange('beddingDepthFt', parseFloat(e.target.value) || 0)} />
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
