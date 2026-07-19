import React, { useState, useEffect } from 'react';
import { FuzzyAutocomplete, materialsToAutocomplete, type AutocompleteItem } from '../../../components/FuzzyAutocomplete';
import { UnitInput } from '../../../components/UnitInput';
import type { AreaConfig, AreaType, GradeMode } from './types';
import { AREA_TYPE_LABELS } from './types';
import { ftToInches } from './takeoffUtils';
import { inchesToFeet } from '../../../../shared/constants/units';
import { fromDisplay, unitLabel } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';

const AREA_OPTIONS = (Object.keys(AREA_TYPE_LABELS) as AreaType[]).map((value) => ({
  value,
  label: AREA_TYPE_LABELS[value],
}));

/** Area purpose: surface restoration (default) or an earthwork grade region. */
const PURPOSE_OPTIONS: { value: GradeMode | 'surface'; label: string }[] = [
  { value: 'surface', label: 'Surface restoration' },
  { value: 'cut_depth', label: 'Earthwork — cut to depth' },
  { value: 'fill_depth', label: 'Earthwork — fill to depth' },
  { value: 'finished_elev', label: 'Earthwork — finished elevation' },
];

/** Default grade value (ft) per earthwork mode when switching purpose. */
const DEFAULT_GRADE_VALUE: Record<GradeMode, number> = {
  cut_depth: 2,
  fill_depth: 2,
  finished_elev: 100,
};

const DEFAULT_CONFIG: AreaConfig = {
  label: '',
  areaType: 'asphalt',
  depthFt: inchesToFeet(4),
  materialId: null,
  assemblyId: null,
  gradeMode: null,
  gradeValueFt: null,
};

interface AreaConfigModalProps {
  onConfirm: (config: AreaConfig) => void;
  onCancel: () => void;
  initialConfig?: AreaConfig;
  lastAreaConfig?: AreaConfig | null;
}

export function AreaConfigModal({ onConfirm, onCancel, initialConfig, lastAreaConfig }: AreaConfigModalProps) {
  const system = useUnitSystem();
  const [config, setConfig] = useState<AreaConfig>(
    // Metric default depth is a round 100 mm rather than 4"'s 101.6 mm
    initialConfig ?? {
      ...DEFAULT_CONFIG,
      ...(system === 'metric' ? { depthFt: inchesToFeet(fromDisplay(100, 'in', 'metric')) } : {}),
    }
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

  const set = <K extends keyof AreaConfig>(field: K, value: AreaConfig[K]) =>
    setConfig((prev) => ({ ...prev, [field]: value }));

  const handleCopyLastArea = () => {
    if (!lastAreaConfig) return;
    setConfig({ ...lastAreaConfig });
    setMaterialId(lastAreaConfig.materialId);
    setAssemblyId(lastAreaConfig.assemblyId);
  };

  const isEarthwork = config.gradeMode != null;

  const setPurpose = (value: GradeMode | 'surface') => {
    if (value === 'surface') {
      set('gradeMode', null);
      set('gradeValueFt', null);
    } else {
      set('gradeMode', value);
      // Carry the current value across cut<->fill; reset when entering a mode
      // fresh (round metric defaults: 0.5 m depth, 100 m datum elevation)
      const fallback = system === 'metric'
        ? fromDisplay(value === 'finished_elev' ? 100 : 0.5, 'ft', 'metric')
        : DEFAULT_GRADE_VALUE[value];
      setConfig((prev) => ({
        ...prev,
        gradeMode: value,
        gradeValueFt: prev.gradeValueFt ?? fallback,
      }));
    }
  };

  const handleConfirm = () => {
    if (isEarthwork) {
      // Earthwork regions are priced by volume (CY), not by a material/assembly.
      onConfirm({
        ...config,
        materialId: null,
        assemblyId: null,
        gradeValueFt: config.gradeValueFt ?? 0,
      });
      return;
    }
    const resolvedAssemblyId = typeof assemblyId === 'string' ? null : assemblyId as number | null;
    onConfirm({
      ...config,
      gradeMode: null,
      gradeValueFt: null,
      // An assembly supersedes a direct material link — don't store both
      materialId: resolvedAssemblyId != null ? null
        : (typeof materialId === 'string' ? null : materialId as number | null),
      assemblyId: resolvedAssemblyId,
    });
  };

  const depthIn = ftToInches(config.depthFt);
  const isElev = config.gradeMode === 'finished_elev';
  // Cut/fill depths get the m ⇄ mm picker, so their labels carry no unit in
  // metric; elevations stay metre-only.
  const gradeValueLabel = isElev
    ? `Finished elevation (${unitLabel('ft', system)})`
    : config.gradeMode === 'fill_depth'
      ? `Fill depth${system === 'metric' ? '' : ' (ft)'}`
      : `Cut depth${system === 'metric' ? '' : ' (ft)'}`;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {initialConfig
              ? (isEarthwork ? 'Edit Earthwork Region' : 'Edit Area Config')
              : (isEarthwork ? 'New Earthwork Region' : 'New Measured Area')}
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
            placeholder='e.g. "Asphalt patch, Main St crossing"'
          />
        </div>

        {/* Purpose: surface restoration vs earthwork */}
        <div className="form-group">
          <label className="form-label">Purpose</label>
          <select
            className="form-control"
            value={config.gradeMode ?? 'surface'}
            onChange={(e) => setPurpose(e.target.value as GradeMode | 'surface')}
          >
            {PURPOSE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {isEarthwork ? (
          <>
            <div className="form-group">
              <label className="form-label">{gradeValueLabel}</label>
              <UnitInput
                mmToggle={!isElev}
                className="form-control"
                value={config.gradeValueFt ?? 0}
                kind="ft"
                step={isElev ? 0.1 : 0.5}
                metricStep={0.1}
                min={isElev ? undefined : 0}
                onChange={(v) => set('gradeValueFt', v)}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
              {config.gradeMode === 'finished_elev'
                ? 'Cut/fill is computed against the existing surface (add spot elevations). Areas above the finished grade cut, below it fill.'
                : `Uniform depth below (cut) or above (fill) existing grade — needs no elevation data. Send to Bid totals the volume as ${unitLabel('cy', system)}.`}
            </div>
          </>
        ) : (
        <>
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
            <label className="form-label">Depth ({unitLabel('in', system)})</label>
            <UnitInput
              className="form-control"
              value={depthIn}
              kind="in"
              step={0.5}
              metricStep={10}
              min={0}
              onChange={(inches) => set('depthFt', inchesToFeet(inches))}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
          Depth 0 measures area only. Set a depth to also get volume ({unitLabel('cy', system)}).
        </div>

        {/* Assembly */}
        <div className="form-group">
          <label className="form-label">Assembly (optional)</label>
          <FuzzyAutocomplete
            items={assemblies}
            value={assemblyId}
            onSelect={(item) => setAssemblyId(item ? item.id : null)}
            placeholder={`Search assemblies (e.g. asphalt patch per ${unitLabel('sy', system)})`}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Send to Bid expands the assembly (materials + labor + equipment) per measured {unitLabel('sy', system)}.
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

        </>
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
