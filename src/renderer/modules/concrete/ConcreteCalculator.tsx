import React, { useState, useMemo } from 'react';
import {
  calculateConcrete, validateInput, explainConcrete,
  DEFAULT_WASTE_PCT, type ConcreteInput, type ConcreteElement,
} from './concreteCalc';
import { CalcPopover } from '../../components/CalcPopover';
import type { CalcBreakdown } from '../../../shared/calcExplain';

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

const ELEMENT_LABELS: Record<ConcreteElement, string> = {
  slab: 'Slab / flatwork',
  footing: 'Footing',
  wall: 'Wall',
};

export function ConcreteCalculator() {
  const [input, setInput] = useState<ConcreteInput>({ ...DEFAULTS });

  const set = <K extends keyof ConcreteInput>(field: K, value: ConcreteInput[K]) =>
    setInput((prev) => ({ ...prev, [field]: value }));

  const errors = useMemo(() => validateInput(input), [input]);
  const result = useMemo(() => (errors.length === 0 ? calculateConcrete(input) : null), [input, errors]);
  const math = useMemo(() => (result ? explainConcrete(input, result) : null), [input, result]);

  const hasError = (field: string) => errors.some((e) => e.field === field);
  const handleReset = () => setInput({ ...DEFAULTS });

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
              <label>{isWall ? 'Wall area (length × height)' : 'Area'} (SF)</label>
              <input
                type="number" className={`form-control ${hasError('areaSF') ? 'input-error' : ''}`}
                value={input.areaSF} min="0" step="10"
                onChange={(e) => set('areaSF', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>{isWall ? 'Wall thickness' : 'Thickness'} (in)</label>
              <input
                type="number" className={`form-control ${hasError('thicknessIn') ? 'input-error' : ''}`}
                value={input.thicknessIn} min="0" step="0.5"
                onChange={(e) => set('thicknessIn', parseFloat(e.target.value) || 0)}
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
                <label>Perimeter (LF)</label>
                <input
                  type="number" className={`form-control ${hasError('perimeterLF') ? 'input-error' : ''}`}
                  value={input.perimeterLF} min="0" step="1"
                  onChange={(e) => set('perimeterLF', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Edge form height (in)</label>
                <input
                  type="number" className="form-control"
                  value={input.formHeightIn} min="0" step="0.5"
                  placeholder={`${input.thicknessIn} (slab)`}
                  onChange={(e) => set('formHeightIn', parseFloat(e.target.value) || 0)}
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
              <label>Subbase depth (in)</label>
              <input
                type="number" className={`form-control ${hasError('subbaseIn') ? 'input-error' : ''}`}
                value={input.subbaseIn} min="0" step="1"
                onChange={(e) => set('subbaseIn', parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <h3 style={{ margin: '18px 0 14px' }}>Reinforcement</h3>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Rebar grid spacing (in, 0 = none)</label>
              <input
                type="number" className={`form-control ${hasError('rebarSpacingIn') ? 'input-error' : ''}`}
                value={input.rebarSpacingIn} min="0" step="1"
                onChange={(e) => set('rebarSpacingIn', parseFloat(e.target.value) || 0)}
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
                <Row label="Concrete (neat)" value={`${result.neatCY.toFixed(2)} CY`} />
                <Row label="Concrete to order" value={`${result.orderCY.toFixed(2)} CY`}
                  sub={`incl. ${input.wastePct}% waste`} breakdown={math?.order} />
                <Row label={isWall ? 'Form contact area' : 'Edge formwork'} value={`${result.formSFCA.toFixed(1)} SFCA`}
                  breakdown={math?.forms} />
                {result.rebarLF > 0 && (
                  <Row label="Rebar (grid)" value={`${result.rebarLF.toFixed(0)} LF`}
                    sub={`${input.rebarSpacingIn}" o.c. each way`} breakdown={math?.rebar ?? undefined} />
                )}
                {result.meshSF > 0 && (
                  <Row label="Welded wire mesh" value={`${result.meshSF.toFixed(0)} SF`} />
                )}
                {result.subbaseCY > 0 && (
                  <Row label="Subbase aggregate" value={`${result.subbaseCY.toFixed(2)} CY`}
                    sub={`${input.subbaseIn}" deep`} breakdown={math?.subbase ?? undefined} />
                )}
                {result.finishSF > 0 && (
                  <Row label="Finished surface" value={`${result.finishSF.toFixed(0)} SF`}
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
            Slab areas measured in plan takeoff already flow to your bid as SY/CY;
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
