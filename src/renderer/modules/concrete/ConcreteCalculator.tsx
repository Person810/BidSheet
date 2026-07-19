import React, { useState, useMemo } from 'react';
import {
  calculateConcrete, validateInput, explainConcrete,
  DEFAULT_WASTE_PCT, type ConcreteInput, type ConcreteElement,
} from './concreteCalc';
import { CalcPopover } from '../../components/CalcPopover';
import type { CalcBreakdown } from '../../../shared/calcExplain';
import { UnitInput } from '../../components/UnitInput';
import { useUnitSystem } from '../../stores/units-store';
import { unitLabel, formatQty, toDisplay, fromDisplay } from '../../../shared/unitSystem';

const DEFAULTS: ConcreteInput = {
  element: 'slab',
  areaSF: 1000,
  thicknessIn: 4,
  perimeterLF: 130,
  formHeightIn: 0,
  formBothFaces: false,
  wastePct: DEFAULT_WASTE_PCT,
  rebarSpacingIn: 18,
  includeMesh: false,
  subbaseIn: 4,
};

/** Metric prefills: round metric numbers (100 m², 100 mm slab, 40 m
 *  perimeter, 450 mm rebar grid, 100 mm subbase) instead of converted feet. */
const METRIC_DEFAULTS: ConcreteInput = {
  ...DEFAULTS,
  areaSF: fromDisplay(100, 'sf', 'metric'),
  thicknessIn: fromDisplay(100, 'in', 'metric'),
  perimeterLF: fromDisplay(40, 'lf', 'metric'),
  rebarSpacingIn: fromDisplay(450, 'in', 'metric'),
  subbaseIn: fromDisplay(100, 'in', 'metric'),
};

const ELEMENT_LABELS: Record<ConcreteElement, string> = {
  slab: 'Slab / flatwork',
  footing: 'Footing',
  wall: 'Wall',
};

export function ConcreteCalculator() {
  const system = useUnitSystem();
  const defaults = system === 'metric' ? METRIC_DEFAULTS : DEFAULTS;
  const [input, setInput] = useState<ConcreteInput>({ ...defaults });

  const set = <K extends keyof ConcreteInput>(field: K, value: ConcreteInput[K]) =>
    setInput((prev) => ({ ...prev, [field]: value }));

  const errors = useMemo(() => validateInput(input), [input]);
  const result = useMemo(() => (errors.length === 0 ? calculateConcrete(input) : null), [input, errors]);
  const math = useMemo(() => (result ? explainConcrete(input, result, system) : null), [input, result, system]);

  const hasError = (field: string) => errors.some((e) => e.field === field);
  const handleReset = () => setInput({ ...defaults });

  const isWall = input.element === 'wall';

  return (
    <div>
      <div className="page-header">
        <h2>Concrete Calculator</h2>
        <button className="btn btn-secondary" onClick={handleReset}>Reset</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        {/* ---- Inputs ---- */}
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Placement</h3>

          <div className="form-group">
            <label>Element</label>
            <select
              className="form-control"
              value={input.element}
              onChange={(e) => set('element', e.target.value as ConcreteElement)}
            >
              {(Object.keys(ELEMENT_LABELS) as ConcreteElement[]).map((k) => (
                <option key={k} value={k}>{ELEMENT_LABELS[k]}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>{isWall ? 'Wall area (length × height)' : 'Area'} ({unitLabel('sf', system)})</label>
              <UnitInput
                kind="sf" className={`form-control ${hasError('areaSF') ? 'input-error' : ''}`}
                value={input.areaSF} min={0} step={10} metricStep={1}
                onChange={(v) => set('areaSF', v)}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>{isWall ? 'Wall thickness' : 'Thickness'} ({unitLabel('in', system)})</label>
              <UnitInput
                kind="in" className={`form-control ${hasError('thicknessIn') ? 'input-error' : ''}`}
                value={input.thicknessIn} min={0} step={0.5} metricStep={10}
                onChange={(v) => set('thicknessIn', v)}
              />
            </div>
          </div>

          {isWall ? (
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={input.formBothFaces}
                  onChange={(e) => set('formBothFaces', e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                Form both faces
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Contact area counts each formed face of the wall.
              </div>
            </div>
          ) : (
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Perimeter ({unitLabel('lf', system)})</label>
                <UnitInput
                  kind="lf" className={`form-control ${hasError('perimeterLF') ? 'input-error' : ''}`}
                  value={input.perimeterLF} min={0} step={1} metricStep={1}
                  onChange={(v) => set('perimeterLF', v)}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Edge form height ({unitLabel('in', system)})</label>
                <UnitInput
                  kind="in" className="form-control"
                  value={input.formHeightIn} min={0} step={0.5} metricStep={10}
                  placeholder={`${toDisplay(input.thicknessIn, 'in', system)} (slab)`}
                  onChange={(v) => set('formHeightIn', v)}
                />
              </div>
            </div>
          )}

          <h3 style={{ margin: '18px 0 14px' }}>Allowances</h3>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Waste / over-order (%)</label>
              <input
                type="number" className={`form-control ${hasError('wastePct') ? 'input-error' : ''}`}
                value={input.wastePct} min="0" max="100" step="1"
                onChange={(e) => set('wastePct', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Subbase depth ({unitLabel('in', system)})</label>
              <UnitInput
                kind="in" className={`form-control ${hasError('subbaseIn') ? 'input-error' : ''}`}
                value={input.subbaseIn} min={0} step={1} metricStep={25}
                onChange={(v) => set('subbaseIn', v)}
              />
            </div>
          </div>

          <h3 style={{ margin: '18px 0 14px' }}>Reinforcement</h3>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Rebar grid spacing ({unitLabel('in', system)}, 0 = none)</label>
              <UnitInput
                kind="in" className={`form-control ${hasError('rebarSpacingIn') ? 'input-error' : ''}`}
                value={input.rebarSpacingIn} min={0} step={1} metricStep={25}
                onChange={(v) => set('rebarSpacingIn', v)}
              />
            </div>
            <div className="form-group" style={{ flex: 1, alignSelf: 'center', paddingTop: 18 }}>
              <label>
                <input
                  type="checkbox"
                  checked={input.includeMesh}
                  onChange={(e) => set('includeMesh', e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                Welded wire mesh
              </label>
            </div>
          </div>
        </div>

        {/* ---- Results ---- */}
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Quantities</h3>
          {result ? (
            <table className="data-table" style={{ width: '100%' }}>
              <tbody>
                <Row label="Concrete (neat)" value={formatQty(result.neatCY, 'cy', system)} />
                <Row label="Concrete to order" value={formatQty(result.orderCY, 'cy', system)}
                  sub={`incl. ${input.wastePct}% waste`} breakdown={math?.order} />
                <Row label={isWall ? 'Form contact area' : 'Edge formwork'}
                  value={formatQty(result.formSFCA, 'sfca', system, 1)}
                  breakdown={math?.forms} />
                {result.rebarLF > 0 && (
                  <Row label="Rebar (grid)" value={formatQty(result.rebarLF, 'lf', system, 0)}
                    sub={system === 'metric'
                      ? `${toDisplay(input.rebarSpacingIn, 'in', system)} mm o.c. each way`
                      : `${input.rebarSpacingIn}" o.c. each way`}
                    breakdown={math?.rebar ?? undefined} />
                )}
                {result.meshSF > 0 && (
                  <Row label="Welded wire mesh" value={formatQty(result.meshSF, 'sf', system, 0)} />
                )}
                {result.subbaseCY > 0 && (
                  <Row label="Subbase aggregate" value={formatQty(result.subbaseCY, 'cy', system)}
                    sub={system === 'metric'
                      ? `${toDisplay(input.subbaseIn, 'in', system)} mm deep`
                      : `${input.subbaseIn}" deep`}
                    breakdown={math?.subbase ?? undefined} />
                )}
                {result.finishSF > 0 && (
                  <Row label="Finished surface" value={formatQty(result.finishSF, 'sf', system, 0)}
                    sub="trowel / cure" />
                )}
              </tbody>
            </table>
          ) : (
            <p className="text-muted" style={{ padding: 24, textAlign: 'center' }}>
              Fix input errors to see results.
            </p>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
            Slab areas measured in plan takeoff already flow to your bid as {system === 'metric' ? 'm²/m³' : 'SY/CY'};
            this calculator is for quick by-hand quantities and ordering.
          </div>
        </div>
      </div>
    </div>
  );
}

/* Small helper -- mirrors the Trench Profiler output table */
function Row({ label, value, sub, breakdown }: { label: string; value: string; sub?: string; breakdown?: CalcBreakdown }) {
  return (
    <tr>
      <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</td>
      <td className="text-right" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {value}
        {breakdown && <CalcPopover breakdown={breakdown} ariaLabel={`Show ${label.toLowerCase()} math`} />}
      </td>
      {sub !== undefined && (
        <td className="text-muted" style={{ fontSize: 12, paddingLeft: 8 }}>{sub}</td>
      )}
    </tr>
  );
}
