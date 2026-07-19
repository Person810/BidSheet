import React, { useState, useMemo } from 'react';
import { FuzzyAutocomplete } from '../../../components/FuzzyAutocomplete';
import { UnitInput } from '../../../components/UnitInput';
import { useTrenchMaterials, NATIVE_MATERIAL_ITEM } from '../useTrenchMaterials';
import { parsePipeSizeFromName } from '../trenchCalc';
import { formatPipeSize, fromDisplay } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';
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

/** Metric defaults: same canonical fields, but round numbers in metres
 *  (1.2 m deep, 1 m wide, 150 mm bedding) instead of round feet. */
const METRIC_DEFAULT_CONFIG: RunConfig = {
  ...DEFAULT_CONFIG,
  startDepthFt: fromDisplay(1.2, 'ft', 'metric'),
  trenchWidthFt: fromDisplay(1, 'ft', 'metric'),
  beddingDepthFt: fromDisplay(0.15, 'ft', 'metric'),
};

/** Standard nominal pipe sizes offered by the metric DN picker. */
const STANDARD_PIPE_SIZES_IN = [2, 3, 4, 6, 8, 10, 12, 15, 18, 21, 24, 27, 30, 36, 42, 48];

interface TrenchConfigModalProps {
  onConfirm: (config: RunConfig) => void;
  onCancel: () => void;
  initialConfig?: RunConfig;
  lastRunConfig?: RunConfig | null;
}

export function TrenchConfigModal({ onConfirm, onCancel, initialConfig, lastRunConfig }: TrenchConfigModalProps) {
  const system = useUnitSystem();
  const [config, setConfig] = useState<RunConfig>(
    initialConfig ?? { ...(system === 'metric' ? METRIC_DEFAULT_CONFIG : DEFAULT_CONFIG) }
  );
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
            {system === 'metric' ? (
              <>
                {/* Nominal sizes are identities (DN200 ↔ 8"), so metric picks
                    from the standard DN list rather than typing millimetres. */}
                <label className="form-label">Pipe Size</label>
                <select
                  className="form-control"
                  value={config.pipeSizeIn}
                  onChange={(e) => set('pipeSizeIn', parseFloat(e.target.value) || 0)}
                >
                  {!STANDARD_PIPE_SIZES_IN.includes(config.pipeSizeIn) && (
                    <option value={config.pipeSizeIn}>{formatPipeSize(config.pipeSizeIn, system)}</option>
                  )}
                  {STANDARD_PIPE_SIZES_IN.map((n) => (
                    <option key={n} value={n}>{formatPipeSize(n, system)}</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label className="form-label">Pipe Size (in)</label>
                <input
                  type="number"
                  className="form-control"
                  value={config.pipeSizeIn}
                  step="1"
                  min="1"
                  onChange={(e) => set('pipeSizeIn', parseFloat(e.target.value) || 0)}
                />
              </>
            )}
          </div>
        </div>

        {/* Depth + Grade */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Starting Depth{system === 'metric' ? '' : ' (ft)'}</label>
            <UnitInput
              mmToggle
              className="form-control"
              value={config.startDepthFt}
              kind="ft"
              step={0.5}
              metricStep={0.1}
              min={0}
              onChange={(v) => set('startDepthFt', v)}
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
            <label className="form-label">Trench Width{system === 'metric' ? '' : ' (ft)'}</label>
            <UnitInput
              mmToggle
              className="form-control"
              value={config.trenchWidthFt}
              kind="ft"
              step={0.5}
              metricStep={0.1}
              min={0}
              onChange={(v) => set('trenchWidthFt', v)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Bench Width{system === 'metric' ? '' : ' (ft)'}</label>
            <UnitInput
              mmToggle
              className="form-control"
              value={config.benchWidthFt}
              kind="ft"
              step={0.5}
              metricStep={0.1}
              min={0}
              onChange={(v) => set('benchWidthFt', v)}
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
            <label className="form-label">Bedding Depth{system === 'metric' ? '' : ' (ft)'}</label>
            <UnitInput
              mmToggle
              className="form-control"
              value={config.beddingDepthFt}
              kind="ft"
              step={0.25}
              metricStep={0.05}
              min={0}
              onChange={(v) => set('beddingDepthFt', v)}
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
