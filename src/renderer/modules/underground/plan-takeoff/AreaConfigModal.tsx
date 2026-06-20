import React, { useState, useEffect } from 'react';
import { FuzzyAutocomplete, materialsToAutocomplete, type AutocompleteItem } from '../../../components/FuzzyAutocomplete';
import type { AreaConfig, AreaType } from './types';
import { AREA_TYPE_LABELS } from './types';
import { ftToInches } from './takeoffUtils';
import { inchesToFeet } from '../../../../shared/constants/units';

const AREA_OPTIONS = (Object.keys(AREA_TYPE_LABELS) as AreaType[]).map((value) => ({
  value,
  label: AREA_TYPE_LABELS[value],
}));

const DEFAULT_CONFIG: AreaConfig = {
  label: '',
  areaType: 'asphalt',
  depthFt: inchesToFeet(4),
  materialId: null,
  assemblyId: null,
};

interface AreaConfigModalProps {
  onConfirm: (config: AreaConfig) => void;
  onCancel: () => void;
  initialConfig?: AreaConfig;
  lastAreaConfig?: AreaConfig | null;
}

export function AreaConfigModal({ onConfirm, onCancel, initialConfig, lastAreaConfig }: AreaConfigModalProps) {
  const [config, setConfig] = useState<AreaConfig>(initialConfig ?? { ...DEFAULT_CONFIG });
  const [materialId, setMaterialId] = useState<number | string | null>(initialConfig?.materialId ?? null);
  const [assemblyId, setAssemblyId] = useState<number | string | null>(initialConfig?.assemblyId ?? null);
  const [materials, setMaterials] = useState<AutocompleteItem[]>([]);
  const [assemblies, setAssemblies] = useState<AutocompleteItem[]>([]);

  useEffect(() => {
    window.api.getMaterials()
      .then((rows: any[]) => setMaterials(materialsToAutocomplete(rows)))
      .catch((err) => console.error('Failed to load materials:', err));
    window.api.getAssemblies()
      .then((rows: any[]) => setAssemblies(rows.map((a: any) => ({
        id: a.id,
        label: a.name,
        sublabel: a.description || `${(a.items || []).length} material${(a.items || []).length !== 1 ? 's' : ''}`,
        detailSub: `per ${a.unit}`,
      }))))
      .catch((err) => console.error('Failed to load assemblies:', err));
  }, []);

  const set = <K extends keyof AreaConfig>(field: K, value: AreaConfig[K]) =>
    setConfig((prev) => ({ ...prev, [field]: value }));

  const handleCopyLastArea = () => {
    if (!lastAreaConfig) return;
    setConfig({ ...lastAreaConfig });
    setMaterialId(lastAreaConfig.materialId);
    setAssemblyId(lastAreaConfig.assemblyId);
  };

  const handleConfirm = () => {
    const resolvedAssemblyId = typeof assemblyId === 'string' ? null : assemblyId as number | null;
    onConfirm({
      ...config,
      // An assembly supersedes a direct material link — don't store both
      materialId: resolvedAssemblyId != null ? null
        : (typeof materialId === 'string' ? null : materialId as number | null),
      assemblyId: resolvedAssemblyId,
    });
  };

  const depthIn = ftToInches(config.depthFt);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {initialConfig ? 'Edit Area Config' : 'New Measured Area'}
          </h3>
          {!initialConfig && lastAreaConfig && (
            <button className="btn btn-secondary btn-sm" onClick={handleCopyLastArea}>
              Copy from last area
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
            placeholder='e.g. "Asphalt patch — Main St crossing"'
          />
        </div>

        {/* Surface Type + Depth */}
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Surface Type</label>
            <select
              className="form-control"
              value={config.areaType}
              onChange={(e) => set('areaType', e.target.value as AreaType)}
            >
              {AREA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Depth (in)</label>
            <input
              type="number"
              className="form-control"
              value={depthIn}
              step="0.5"
              min="0"
              onChange={(e) => set('depthFt', inchesToFeet(parseFloat(e.target.value) || 0))}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
          Depth 0 measures area only. Set a depth to also get volume (CY).
        </div>

        {/* Assembly */}
        <div className="form-group">
          <label className="form-label">Assembly (optional)</label>
          <FuzzyAutocomplete
            items={assemblies}
            value={assemblyId}
            onSelect={(item) => setAssemblyId(item ? item.id : null)}
            placeholder="Search assemblies (e.g. asphalt patch per SY)"
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Send to Bid expands the assembly (materials + labor + equipment) per measured SY.
          </div>
        </div>

        {/* Material (used when no assembly is linked) */}
        {assemblyId == null && (
          <div className="form-group">
            <label className="form-label">Material (optional)</label>
            <FuzzyAutocomplete
              items={materials}
              value={materialId}
              onSelect={(item) => setMaterialId(item ? item.id : null)}
              placeholder="Search material (e.g. asphalt, concrete)"
            />
            {materialId == null && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Link a catalog material or an assembly so Send to Bid can include pricing.
              </div>
            )}
          </div>
        )}

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
