import React, { useState, useEffect } from 'react';
import { FuzzyAutocomplete, materialsToAutocomplete, type AutocompleteItem } from '../../../components/FuzzyAutocomplete';
import { UnitInput } from '../../../components/UnitInput';
import { fromDisplay, unitLabel } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';
import type { WallConfig } from './types';

const DEFAULT_CONFIG: WallConfig = {
  label: '',
  heightFt: 8,
  thicknessIn: 8,
  faces: 2,
  memberSpacingIn: 0,
  materialId: null,
  assemblyId: null,
};

/** Metric defaults: round metric numbers (2.4 m high, 200 mm thick). */
const METRIC_DEFAULT_CONFIG: WallConfig = {
  ...DEFAULT_CONFIG,
  heightFt: fromDisplay(2.4, 'ft', 'metric'),
  thicknessIn: fromDisplay(200, 'in', 'metric'),
};

interface WallConfigModalProps {
  onConfirm: (config: WallConfig) => void;
  onCancel: () => void;
  initialConfig?: WallConfig;
  lastWallConfig?: WallConfig | null;
}

export function WallConfigModal({ onConfirm, onCancel, initialConfig, lastWallConfig }: WallConfigModalProps) {
  const system = useUnitSystem();
  const [config, setConfig] = useState<WallConfig>(
    initialConfig ?? { ...(system === 'metric' ? METRIC_DEFAULT_CONFIG : DEFAULT_CONFIG) }
  );
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

  const set = <K extends keyof WallConfig>(field: K, value: WallConfig[K]) =>
    setConfig((prev) => ({ ...prev, [field]: value }));

  const handleCopyLast = () => {
    if (!lastWallConfig) return;
    setConfig({ ...lastWallConfig });
    setMaterialId(lastWallConfig.materialId);
    setAssemblyId(lastWallConfig.assemblyId);
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

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {initialConfig ? 'Edit Wall Run' : 'New Wall Run'}
          </h3>
          {!initialConfig && lastWallConfig && (
            <button className="btn btn-secondary btn-sm" onClick={handleCopyLast}>
              Copy from last wall
            </button>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Label (optional)</label>
          <input
            className="form-control"
            value={config.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder='e.g. "Foundation wall, north"'
          />
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Height{system === 'metric' ? '' : ' (ft)'}</label>
            <UnitInput
              mmToggle
              className="form-control" value={config.heightFt} kind="ft"
              min={0} step={0.5} metricStep={0.1}
              onChange={(v) => set('heightFt', v)}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Thickness ({unitLabel('in', system)})</label>
            <UnitInput
              className="form-control" value={config.thicknessIn} kind="in"
              min={0} step={0.5} metricStep={10}
              onChange={(v) => set('thicknessIn', v)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Faces (finished / formed)</label>
            <select
              className="form-control"
              value={config.faces}
              onChange={(e) => set('faces', parseInt(e.target.value, 10))}
            >
              <option value={2}>Both faces (2)</option>
              <option value={1}>One face (1)</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Member spacing ({unitLabel('in', system)}, 0 = none)</label>
            <UnitInput
              className="form-control" value={config.memberSpacingIn} kind="in"
              min={0} step={1} metricStep={50}
              onChange={(v) => set('memberSpacingIn', v)}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4, marginBottom: 12 }}>
          Trace the wall along its length. Send to Bid uses length, height, and thickness for
          surface area and volume; member spacing counts vertical members (studs, bars, posts).
          Attach a material or assembly to set what's billed.
        </div>

        <div className="form-group">
          <label className="form-label">Assembly (optional)</label>
          <FuzzyAutocomplete
            items={assemblies}
            value={assemblyId}
            onSelect={(item) => setAssemblyId(item ? item.id : null)}
            placeholder={system === 'metric'
              ? 'Search assemblies (e.g. wall per m / m² / m³)'
              : 'Search assemblies (e.g. wall per LF / SF / CY)'}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Send to Bid expands the assembly (materials + labor + equipment) by the measure
            matching its unit — {system === 'metric'
              ? 'm of wall, m² of surface, or m³ of volume'
              : 'LF of wall, SF of surface, or CY of volume'}.
          </div>
        </div>

        {assemblyId == null && (
          <div className="form-group">
            <label className="form-label">Material (optional)</label>
            <FuzzyAutocomplete
              items={materials}
              value={materialId}
              onSelect={(item) => setMaterialId(item ? item.id : null)}
              placeholder="Search material (e.g. concrete mix, CMU, stud)"
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              The wall line bills in the material's unit — {system === 'metric'
                ? 'm (length), m² (surface), or m³ (volume)'
                : 'LF (length), SF/SY (surface), or CY (volume)'}.
            </div>
          </div>
        )}

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
