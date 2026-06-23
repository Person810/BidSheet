import React, { useState, useEffect } from 'react';
import { FuzzyAutocomplete, materialsToAutocomplete, type AutocompleteItem } from '../../../components/FuzzyAutocomplete';
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

interface WallConfigModalProps {
  onConfirm: (config: WallConfig) => void;
  onCancel: () => void;
  initialConfig?: WallConfig;
  lastWallConfig?: WallConfig | null;
}

export function WallConfigModal({ onConfirm, onCancel, initialConfig, lastWallConfig }: WallConfigModalProps) {
  const [config, setConfig] = useState<WallConfig>(initialConfig ?? { ...DEFAULT_CONFIG });
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
            <label className="form-label">Height (ft)</label>
            <input
              type="number" className="form-control" value={config.heightFt} min="0" step="0.5"
              onChange={(e) => set('heightFt', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Thickness (in)</label>
            <input
              type="number" className="form-control" value={config.thicknessIn} min="0" step="0.5"
              onChange={(e) => set('thicknessIn', parseFloat(e.target.value) || 0)}
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
            <label className="form-label">Member spacing (in, 0 = none)</label>
            <input
              type="number" className="form-control" value={config.memberSpacingIn} min="0" step="1"
              onChange={(e) => set('memberSpacingIn', parseFloat(e.target.value) || 0)}
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
            placeholder="Search assemblies (e.g. wall per LF / SF / CY)"
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Send to Bid expands the assembly (materials + labor + equipment) by the measure
            matching its unit — LF of wall, SF of surface, or CY of volume.
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
              The wall line bills in the material's unit — LF (length), SF/SY (surface), or CY (volume).
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
