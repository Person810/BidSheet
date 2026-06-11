import React, { useMemo } from 'react';
import type { TakeoffRun } from './types';
import { buildRunProfile, niceTickStep, segmentGrades } from './profileModel';

interface RunProfileViewProps {
  run: TakeoffRun;
  scalePxPerFt: number;
  /** Plot size in CSS px */
  width?: number;
  height?: number;
}

const M = { top: 34, right: 26, bottom: 34, left: 58 };

/**
 * Side-view profile of a pipe run: ground line, trench and bedding zones,
 * pipe band at grade, structures with rim/invert callouts, and per-segment
 * grade labels. Vertical scale is exaggerated to fit, like a CAD profile
 * sheet, with the exaggeration factor shown.
 */
export function RunProfileView({ run, scalePxPerFt, width = 880, height = 420 }: RunProfileViewProps) {
  const profile = useMemo(() => buildRunProfile(run, scalePxPerFt), [run, scalePxPerFt]);

  if (!profile) {
    return <p className="text-muted">This run has no measurable length yet.</p>;
  }

  const plotW = width - M.left - M.right;
  const plotH = height - M.top - M.bottom;

  // Pad the elevation range so flat short runs don't get absurd exaggeration
  const rawSpan = profile.maxElev - profile.minElev;
  const elevPad = Math.max(rawSpan * 0.15, 1);
  const elevMin = profile.minElev - elevPad;
  const elevMax = profile.maxElev + elevPad;
  const elevSpan = Math.max(elevMax - elevMin, 4);

  const sx = (station: number) => M.left + (station / profile.totalLengthFt) * plotW;
  const sy = (elev: number) => M.top + ((elevMax - elev) / elevSpan) * plotH;

  const verticalExaggeration = (plotH / elevSpan) / (plotW / profile.totalLengthFt);

  const stationStep = niceTickStep(profile.totalLengthFt);
  const elevStep = niceTickStep(elevSpan);
  const stationTicks: number[] = [];
  for (let s = 0; s <= profile.totalLengthFt + 0.01; s += stationStep) stationTicks.push(s);
  const elevTicks: number[] = [];
  for (let e = Math.ceil(elevMin / elevStep) * elevStep; e <= elevMax; e += elevStep) {
    // In depth mode the datum is ground level — "negative depth" ticks are noise
    if (profile.mode === 'depth' && e > 0.001) continue;
    elevTicks.push(e);
  }

  const pts = profile.stations;
  const grades = segmentGrades(profile);

  const groundPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.station)},${sy(p.ground)}`).join(' ');
  const invertPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.station)},${sy(p.invert)}`).join(' ');

  // Closed regions: trench (ground → trench bottom), bedding, pipe band
  const forward = (elevOf: (p: typeof pts[number]) => number) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.station)},${sy(elevOf(p))}`).join(' ');
  const backward = (elevOf: (p: typeof pts[number]) => number) =>
    [...pts].reverse().map((p) => `L${sx(p.station)},${sy(elevOf(p))}`).join(' ');

  const trenchRegion = `${forward((p) => p.ground)} ${backward((p) => p.invert - profile.beddingDepthFt)} Z`;
  const beddingRegion = `${forward((p) => p.invert)} ${backward((p) => p.invert - profile.beddingDepthFt)} Z`;
  const pipeRegion = `${forward((p) => p.invert + profile.pipeDiaFt)} ${backward((p) => p.invert)} Z`;

  const structures = pts.filter((p) => p.structureType || p.rim != null);
  const fmtElev = (v: number) => v.toFixed(2);
  const fmtDepth = (v: number) => `${v.toFixed(1)}'`;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        fontFamily="system-ui, sans-serif">
        {/* Plot frame + grid */}
        <rect x={M.left} y={M.top} width={plotW} height={plotH}
          fill="var(--bg-primary, #111419)" stroke="var(--border, #333)" />
        {elevTicks.map((e) => (
          <g key={`e${e}`}>
            <line x1={M.left} y1={sy(e)} x2={M.left + plotW} y2={sy(e)}
              stroke="var(--border, #333)" strokeWidth={0.5} strokeDasharray="2 4" />
            <text x={M.left - 6} y={sy(e) + 3} textAnchor="end" fontSize={10}
              fill="var(--text-muted, #888)">{profile.mode === 'elevation' ? fmtElev(e) : fmtDepth(-e)}</text>
          </g>
        ))}
        {stationTicks.map((s) => (
          <g key={`s${s}`}>
            <line x1={sx(s)} y1={M.top} x2={sx(s)} y2={M.top + plotH}
              stroke="var(--border, #333)" strokeWidth={0.5} strokeDasharray="2 4" />
            <text x={sx(s)} y={M.top + plotH + 14} textAnchor="middle" fontSize={10}
              fill="var(--text-muted, #888)">{s.toFixed(0)}'</text>
          </g>
        ))}
        {/* Axis titles */}
        <text x={M.left + plotW / 2} y={height - 6} textAnchor="middle" fontSize={10}
          fill="var(--text-secondary, #aaa)">Station (ft)</text>
        <text x={14} y={M.top + plotH / 2} textAnchor="middle" fontSize={10}
          fill="var(--text-secondary, #aaa)"
          transform={`rotate(-90 14 ${M.top + plotH / 2})`}>
          {profile.mode === 'elevation' ? 'Elevation (ft)' : 'Depth below grade'}
        </text>

        {/* Trench, bedding, pipe */}
        <path d={trenchRegion} fill="var(--text-muted, #888)" opacity={0.16} />
        <path d={beddingRegion} fill="#b8a06a" opacity={0.45} />
        <path d={pipeRegion} fill={run.color} opacity={0.9} stroke={run.color} strokeWidth={1} />
        <path d={invertPath} fill="none" stroke={run.color} strokeWidth={1.5} />

        {/* Ground line */}
        <path d={groundPath} fill="none" stroke="var(--success, #4caf50)" strokeWidth={2}
          strokeDasharray={profile.groundAssumed ? '7 5' : undefined} />
        {(() => {
          // Label the ground line at quarter-span, clear of structure callouts
          const labelStation = profile.totalLengthFt * 0.25;
          const groundHere = pts.reduce((acc, p) =>
            p.station <= labelStation ? p.ground : acc, pts[0].ground);
          return (
            <text x={sx(labelStation)} y={sy(groundHere) - 8} textAnchor="middle"
              fontSize={10} fill="var(--success, #4caf50)">
              {profile.groundAssumed ? 'ground (assumed)' : 'ground'}
            </text>
          );
        })()}

        {/* Per-segment grade labels along the pipe */}
        {grades.map((g, i) => {
          const a = pts[i];
          const b = pts[i + 1];
          if (b.station - a.station < profile.totalLengthFt * 0.05) return null;
          const mx = (sx(a.station) + sx(b.station)) / 2;
          const my = (sy(a.invert) + sy(b.invert)) / 2;
          return (
            <text key={`g${i}`} x={mx} y={my + 16} textAnchor="middle" fontSize={10}
              fill="var(--text-secondary, #aaa)">{g.toFixed(2)}%</text>
          );
        })}

        {/* Structures: shaft from ground to invert with callouts */}
        {structures.map((p, i) => {
          const x = sx(p.station);
          const above = sy(p.ground);
          const below = sy(p.invert);
          return (
            <g key={`st${i}`}>
              <rect x={x - 5} y={above} width={10} height={below - above}
                fill="var(--bg-secondary, #222)" stroke="var(--text-secondary, #aaa)" strokeWidth={1} />
              <text x={x} y={above - 18} textAnchor="middle" fontSize={10} fontWeight={600}
                fill="var(--text-primary, #ddd)">{p.structureType || 'STR'}</text>
              <text x={x} y={above - 7} textAnchor="middle" fontSize={9}
                fill="var(--text-muted, #888)">
                {p.rim != null ? `RIM ${fmtElev(p.rim)}` : ''}
              </text>
              <text x={x} y={sy(p.invert - profile.beddingDepthFt) + 12} textAnchor="middle" fontSize={9}
                fill="var(--text-muted, #888)">
                {p.knownInvert ? `INV ${fmtElev(p.invert)}` : ''}
              </text>
            </g>
          );
        })}

        {/* Depth callouts at vertices without structures */}
        {pts.map((p, i) => {
          if (p.structureType || p.rim != null) return null;
          const depth = p.ground - p.invert;
          return (
            <text key={`d${i}`} x={sx(p.station)} y={sy(p.invert - profile.beddingDepthFt) + 12}
              textAnchor="middle" fontSize={9}
              fill="var(--text-muted, #888)">{fmtDepth(depth)}</text>
          );
        })}

        {/* Vertical exaggeration note */}
        <text x={M.left + plotW - 4} y={M.top + 12} textAnchor="end" fontSize={9}
          fill="var(--text-muted, #888)">V.E. ≈ {verticalExaggeration.toFixed(1)}×</text>
      </svg>

      <div className="flex gap-8" style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{run.pipeSizeIn}" {run.pipeMaterial}</span>
        <span>·</span>
        <span>{profile.totalLengthFt.toFixed(1)} LF</span>
        <span>·</span>
        <span>bedding {profile.beddingDepthFt}'</span>
        {profile.mode === 'depth' && (
          <>
            <span>·</span>
            <span>depths from start depth + design grade (no surveyed inverts)</span>
          </>
        )}
      </div>
    </div>
  );
}
