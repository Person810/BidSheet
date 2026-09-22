import React from 'react';
import { UnitInput } from '../../components/UnitInput';
import { useUnitSystem } from '../../stores/units-store';
import { unitLabel, convertQty } from '../../../shared/unitSystem';
import { nextPitLabel, type PitSummary, type TrenchPit } from '../../../shared/trenchPits';

interface Props {
  pits: TrenchPit[];
  summary: PitSummary;
  /** Profile labels by index, to show which runs use each pit. */
  profileLabels: string[];
  onChange: (pits: TrenchPit[]) => void;
}

function newPitId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `pit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * The job's launch / exit / change-of-direction pits (#149). Profiles pick
 * their start and end pit from this list; a pit two runs share is one row
 * here and counts once in the totals.
 */
export function TrenchPitsCard({ pits, summary, profileLabels, onChange }: Props) {
  const system = useUnitSystem();
  const usedBy = new Map(summary.used.map((u) => [u.pit.id, u]));
  const cy = (n: number) => Math.round(convertQty(n, 'cy', system) * 100) / 100;

  const update = (id: string, patch: Partial<TrenchPit>) =>
    onChange(pits.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addPit = () => {
    const last = pits[pits.length - 1];
    onChange([...pits, {
      id: newPitId(),
      label: nextPitLabel(pits),
      // Most jobs repeat one pit size; start from the last one entered.
      widthFt: last?.widthFt || 4,
      lengthFt: last?.lengthFt || 6,
      depthFt: last?.depthFt || 5,
    }]);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div className="flex justify-between items-center" style={{ padding: '0 8px 6px' }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          Pits: launch, exit and change-of-direction pits. Pick them as a run&apos;s start or end pit;
          a pit shared by two runs counts once.
        </span>
        <button className="btn btn-sm btn-secondary no-print" onClick={addPit}>+ Pit</button>
      </div>
      {pits.length > 0 && (
        <table className="bid-grid">
          <thead>
            <tr>
              <th>Pit</th>
              <th className="text-right">Width ({unitLabel('ft', system)})</th>
              <th className="text-right">Length ({unitLabel('ft', system)})</th>
              <th className="text-right">Depth ({unitLabel('ft', system)})</th>
              <th className="text-right">Volume ({unitLabel('cy', system)})</th>
              <th>Used by</th>
              <th className="no-print" style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {pits.map((p) => {
              const use = usedBy.get(p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <input type="text" className="form-control" aria-label="Pit label" style={{ minWidth: 90 }}
                      value={p.label} onChange={(e) => update(p.id, { label: e.target.value })} />
                  </td>
                  <td>
                    <UnitInput kind="ft" className="form-control" value={p.widthFt} step={0.5} metricStep={0.1} min={0}
                      onChange={(v) => update(p.id, { widthFt: v })} />
                  </td>
                  <td>
                    <UnitInput kind="ft" className="form-control" value={p.lengthFt} step={0.5} metricStep={0.1} min={0}
                      onChange={(v) => update(p.id, { lengthFt: v })} />
                  </td>
                  <td>
                    <UnitInput kind="ft" className="form-control" value={p.depthFt} step={0.5} metricStep={0.1} min={0}
                      onChange={(v) => update(p.id, { depthFt: v })} />
                  </td>
                  <td className="text-right">{use ? cy(use.volumeCY) : '--'}</td>
                  <td className={use ? '' : 'text-muted'} style={{ fontSize: 12 }}>
                    {use
                      ? use.profileIndexes.map((i) => profileLabels[i]).join(', ')
                      : 'Not used by any run (not counted)'}
                  </td>
                  <td className="no-print">
                    <button className="btn btn-sm btn-secondary" title="Delete pit" aria-label={`Delete pit ${p.label}`}
                      onClick={() => onChange(pits.filter((x) => x.id !== p.id))}>&times;</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
