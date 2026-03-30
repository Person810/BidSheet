import React, { useState, useMemo } from 'react';
import { FuzzyAutocomplete } from '../../../components/FuzzyAutocomplete';
import { useTrenchMaterials, NATIVE_MATERIAL_ITEM } from '../useTrenchMaterials';
import { parsePipeSizeFromName } from '../trenchCalc';
import type { RunConfig, UtilityType } from './types';

const UTILITY_OPTIONS: { value: UtilityType; label: string }[] = [
  { value: 'sanitary', label: 'Sanitary Sewer' },
  { value: 'storm', label: 'Storm Drain' },
  { value: 'water', label: 'Water' },
  { value: 'fiber', label: 'Fiber / Conduit' },
  { value: 'other', label: 'Other' },
];

const DEFAULT_CONFIG: RunConfig = {
  label: '',
  utilityType: 'sanitary',
  pipeSizeIn: 8,
  pipeMaterial: '',
  pipeMaterialId: null,
  startDepthFt: 4,
  gradePct: 2.0,
  trenchWidthFt: 3,
  benchWidthFt: 0,
  beddingType: '',
  beddingDepthFt: 0.5,
  beddingMaterialId: null,
  backfillType: 'Native Material',
  backfillMaterialId: null,
};

interface TrenchConfigModalProps {
  onConfirm: (config: RunConfig) => void;
  onCancel: () => void;
  initialConfig?: RunConfig;
  lastRunConfig?: RunConfig | null;
}

export function TrenchConfigModal({ onConfirm, onCancel, initialConfig, lastRunConfig }: TrenchConfigModalProps) {
  const [config, setConfig] = useState<RunConfig>(initialConfig ?? { ...DEFAULT_CONFIG });
  const [pipeMaterialId, setPipeMaterialId] = useState<number | string | null>(initialConfig?.pipeMaterialId ?? null);
  const [beddingMaterialId, setBeddingMaterialId] = useState<number | string | null>(initialConfig?.beddingMaterialId ?? null);
  const [backfillMaterialId, setBackfillMaterialId] = useState<number | string | null>(
    initialConfig?.backfillMaterialId ?? 'native'
  );

  const { pipeMaterials, beddingMaterials } = useTrenchMaterials();
  const backfillItems = useMemo(() => [NATIVE_MATERIAL_ITEM, ...beddingMaterials], [beddingMaterials]);

  const set = <K extends keyof RunConfig>(field: K, value: RunConfig[K]) =>
    setConfig((prev) => ({ ...prev, [field]: value }));

  const handleCopyLastRun = () => {
    if (!lastRunConfig) return;
    setConfig({ ...lastRunConfig });
    setPipeMaterialId(lastRunConfig.pipeMaterialId);
    setBeddingMaterialId(lastRunConfig.beddingMaterialId);
    setBackfillMaterialId(lastRunConfig.backfillMaterialId ?? 'native');
  };

  const handleConfirm = () => {
    onConfirm({
      ...config,
      pipeMaterialId: typeof pipeMaterialId === 'string' ? null : pipeMaterialId as number | null,
      beddingMaterialId: typeof beddingMaterialId === 'string' ? null : beddingMaterialId as number | null,
      backfillMaterialId: typeof backfillMaterialId === 'string' ? null : backfillMaterialId as number | null,
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {initialConfig ? 'Edit Run Config' : 'New Pipe Run'}
          </h3>
          {!initialConfig && lastRunConfig && (
            <button className="btn btn-secondary btn-sm" onClick={handleCopyLastRun}>
              Copy from last run
            </button>
          )}
        </div>

        {/* Label */}
        <div className="form-group">
          <label className="form-label">Label (optional)</label>
          <input
            className="form-control"
            value={config.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder='e.g. "San. Sewer MH-1 to MH-2"'
          />
        </div>

        {/* Utility Type */}
        <div className="form-group">
          <label className="form-label">Utility Type</label>
          <select
            className="form-control"
            value={config.utilityType}
            onChange={(e) => set('utilityType', e.target.value as UtilityType)}
          >
            {UTILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Pipe Material + Size */}
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Pipe Material</label>
            <FuzzyAutocomplete
              items={pipeMaterials}
              value={pipeMaterialId}
              onSelect={(item) => {
                if (item) {
                  setPipeMaterialId(item.id);
                  set('pipeMaterial', item.label);
                  const size = parsePipeSizeFromName(item.label);
                  if (size > 0) set('pipeSizeIn', size);
                } else {
                  setPipeMaterialId(null);
                  set('pipeMaterial', '');
                }
              }}
              placeholder="Search pipe (e.g. 8 PVC)"
            />
            {!pipeMaterialId && config.pipeMaterial === '' && (
              <div style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>
                No pipe material selected. Send to Bid won't include material pricing.
              </div>
            )}
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Pipe Size (in)</label>
            <input
              type="number"
              className="form-control"
              value={config.pipeSizeIn}
              step="1"
              min="1"
              onChange={(e) => set('pipeSizeIn', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        {/* Depth + Grade */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Starting Depth (ft)</label>
            <input
              type="number"
              className="form-control"
              value={config.startDepthFt}
              step="0.5"
              min="0"
              onChange={(e) => set('startDepthFt', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Grade (%)</label>
            <input
              type="number"
              className="form-control"
              value={config.gradePct}
              step="0.1"
              min="0"
              onChange={(e) => set('gradePct', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        {/* Trench Width + Bench Width */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Trench Width (ft)</label>
            <input
              type="number"
              className="form-control"
              value={config.trenchWidthFt}
              step="0.5"
              min="0"
              onChange={(e) => set('trenchWidthFt', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Bench Width (ft)</label>
            <input
              type="number"
              className="form-control"
              value={config.benchWidthFt}
              step="0.5"
              min="0"
              onChange={(e) => set('benchWidthFt', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        {/* Bedding Material + Depth */}
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Bedding Material</label>
            <FuzzyAutocomplete
              items={beddingMaterials}
              value={beddingMaterialId}
              onSelect={(item) => {
                if (item) {
                  setBeddingMaterialId(item.id);
                  set('beddingType', item.label);
                } else {
                  setBeddingMaterialId(null);
                  set('beddingType', '');
                }
              }}
              placeholder="Search bedding material..."
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Bedding Depth (ft)</label>
            <input
              type="number"
              className="form-control"
              value={config.beddingDepthFt}
              step="0.25"
              min="0"
              onChange={(e) => set('beddingDepthFt', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        {/* Backfill Type */}
        <div className="form-group">
          <label className="form-label">Backfill Type</label>
          <FuzzyAutocomplete
            items={backfillItems}
            value={backfillMaterialId}
            onSelect={(item) => {
              if (item) {
                setBackfillMaterialId(item.id);
                set('backfillType', item.label);
              } else {
                setBackfillMaterialId(null);
                set('backfillType', '');
              }
            }}
            placeholder="Search backfill type..."
          />
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            {initialConfig ? 'Save Changes' : 'Start Drawing'}
          </button>
        </div>
      </div>
    </div>
  );
}
