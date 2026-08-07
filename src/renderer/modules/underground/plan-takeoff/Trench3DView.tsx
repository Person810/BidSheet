import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { TakeoffRun } from './types';
import type { GroundSampler } from './profileModel';
import { formatPipeSize, formatQty } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';
import {
  buildRunGeometry,
  prismCorners,
  PRISM_INDICES,
  type Trench3DModel,
  type Trench3DSegment,
} from './trench3dModel';

interface Trench3DViewProps {
  run: TakeoffRun;
  scalePxPerFt: number;
  groundSampler?: GroundSampler;
  height?: number;
  isHDD?: boolean;
  includePits?: boolean;
}

const EARTH = '#7a5c32';
const BEDDING = '#c4a86e';
const STRUCTURE = '#9aa0a6';
const TERRAIN_GRID = 36;
const TERRAIN_BUFFER_FT = 40;

/** One swept trapezoidal prism (excavation envelope or bedding zone). */
function Prism({
  seg, halfWidth, topA, topB, botA, botB, color, opacity,
}: {
  seg: Trench3DSegment; halfWidth: number;
  topA: number; topB: number; botA: number; botB: number;
  color: string; opacity: number;
}) {
  const geometry = useMemo(() => {
    const corners = prismCorners(seg, halfWidth, topA, topB, botA, botB);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    g.setIndex(PRISM_INDICES);
    g.computeVertexNormals();
    return g;
  }, [seg, halfWidth, topA, topB, botA, botB]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
        flatShading
        roughness={0.9}
        metalness={0}
      />
    </mesh>
  );
}

/** One straight pipe segment between two centerline points. */
function PipeSegment({
  from, to, radius, color,
}: {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  radius: number; color: string;
}) {
  const geometry = useMemo(() => {
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    );
    return new THREE.TubeGeometry(curve, 1, radius, 14, false);
  }, [from, to, radius]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
    </mesh>
  );
}

/**
 * Pipe rendered as straight segments so each span is a true cylinder — bends
 * are sharp at the vertex (matching a fitting joint). A slightly larger sphere
 * sits at each interior bend to represent the fitting coupling.
 */
function PipeRun({ model, color, additionalPipes = [] }: { model: Trench3DModel; color: string; additionalPipes?: Array<{ radius: number; color: string }> }) {
  const mainRadius = Math.max(model.pipeDiaFt / 2, 0.05);
  const cl = model.pipeCenterline;

  const totalBores = 1 + additionalPipes.length;
  const spacing = Math.max(model.pipeDiaFt * 2.0, 0.3); // space by 2x diameter, min 0.3 ft

  return (
    <>
      {Array.from({ length: totalBores }).map((_, b) => {
        const offsetZ = (b - (totalBores - 1) / 2) * spacing;
        const radius = b === 0 ? mainRadius : additionalPipes[b - 1].radius;
        const pipeColor = b === 0 ? color : additionalPipes[b - 1].color;

        return (
          <group key={b} position={[0, 0, offsetZ]}>
            {cl.map((pt, i) => {
              if (i === 0) return null;
              return (
                <PipeSegment key={i} from={cl[i - 1]} to={pt} radius={radius} color={pipeColor} />
              );
            })}
            {/* Fitting ball at each interior vertex */}
            {cl.slice(1, -1).map((pt, i) => (
              <mesh key={i} position={[pt.x, pt.y, pt.z]}>
                <sphereGeometry args={[radius * 1.18, 14, 10]} />
                <meshStandardMaterial color={pipeColor} roughness={0.3} metalness={0.2} />
              </mesh>
            ))}
          </group>
        );
      })}
    </>
  );
}

/** Vertical shaft (manhole / structure) from ground to invert. */
function Structure({ x, z, ground, invert }: { x: number; z: number; ground: number; invert: number }) {
  const h = Math.max(ground - invert, 0.1);
  return (
    <mesh position={[x, invert + h / 2, z]}>
      <cylinderGeometry args={[1.0, 1.0, h, 20]} />
      <meshStandardMaterial color={STRUCTURE} roughness={0.7} metalness={0.2} />
    </mesh>
  );
}

/** Rectangular Launch / Exit pit for HDD */
function Pit({ x, ground, z, width, length, depth, color }: { x: number; ground: number; z: number; width: number; length: number; depth: number; color: string }) {
  const h = Math.max(depth, 0.1);
  const edgesGeom = useMemo(() => {
    const box = new THREE.BoxGeometry(length, h, width);
    return new THREE.EdgesGeometry(box);
  }, [width, h, length]);

  return (
    <group position={[x, ground - h / 2, z]}>
      <mesh>
        <boxGeometry args={[length, h, width]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          roughness={0.95}
          metalness={0.0}
        />
      </mesh>
      <lineSegments geometry={edgesGeom}>
        <lineBasicMaterial color="#ffffff" opacity={0.3} transparent />
      </lineSegments>
    </group>
  );
}

/**
 * Terrain mesh sampled on a regular grid over the pipe corridor.
 * Clips to the run bounding box + TERRAIN_BUFFER_FT each side, and only
 * renders cells where the groundSampler returns a value (inside the TIN).
 */
function TerrainMesh({
  groundSampler, run, scalePxPerFt, offset,
}: {
  groundSampler: GroundSampler; run: TakeoffRun; scalePxPerFt: number;
  offset: [number, number, number];
}) {
  const geometry = useMemo(() => {
    let cx = 0, cy = 0;
    for (const p of run.points) { cx += p.x; cy += p.y; }
    cx /= run.points.length;
    cy /= run.points.length;
    const toX = (px: number) => (px - cx) / scalePxPerFt;
    const toZ = (py: number) => (py - cy) / scalePxPerFt;

    const bufPx = TERRAIN_BUFFER_FT * scalePxPerFt;
    const xs = run.points.map((p) => p.x);
    const ys = run.points.map((p) => p.y);
    const x0 = Math.min(...xs) - bufPx, x1 = Math.max(...xs) + bufPx;
    const y0 = Math.min(...ys) - bufPx, y1 = Math.max(...ys) + bufPx;

    const N = TERRAIN_GRID;
    const vidx: (number | null)[][] = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(null));
    const positions: number[] = [];

    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const xPx = x0 + (x1 - x0) * (i / N);
        const yPx = y0 + (y1 - y0) * (j / N);
        const z = groundSampler(xPx, yPx);
        if (z != null) {
          vidx[i][j] = positions.length / 3;
          positions.push(toX(xPx), z, toZ(yPx));
        }
      }
    }

    const indices: number[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = vidx[i][j], b = vidx[i + 1][j], c = vidx[i + 1][j + 1], d = vidx[i][j + 1];
        if (a != null && b != null && c != null) indices.push(a, b, c);
        if (a != null && c != null && d != null) indices.push(a, c, d);
      }
    }

    if (positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [groundSampler, run, scalePxPerFt]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={offset}>
      <meshStandardMaterial
        color="#4d7a3a"
        transparent
        opacity={0.38}
        side={THREE.DoubleSide}
        roughness={0.85}
        metalness={0}
      />
    </mesh>
  );
}

function Scene({ model, run, groundSampler, scalePxPerFt, hasBench, isHDD, includePits, additionalPipes }: {
  model: Trench3DModel; run: TakeoffRun;
  groundSampler?: GroundSampler; scalePxPerFt: number;
  hasBench: boolean;
  isHDD?: boolean;
  includePits?: boolean;
  additionalPipes?: Array<{ radius: number; color: string }>;
}) {
  const offset: [number, number, number] = [-model.center.x, -model.center.y, -model.center.z];
  const floorY = -model.radius;

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[model.radius, model.radius * 2.5, model.radius * 0.5]} intensity={1.2} />
      <directionalLight position={[-model.radius * 0.5, model.radius, -model.radius]} intensity={0.35} />

      {groundSampler && (
        <TerrainMesh
          groundSampler={groundSampler}
          run={run}
          scalePxPerFt={scalePxPerFt}
          offset={offset}
        />
      )}

      <group position={offset}>
        {!isHDD && model.segments.map((seg, i) => (
          <React.Fragment key={i}>
            {/*
             * Stair-step bench geometry:
             *   Upper zone  (ground → invert): full cut width including benches
             *   Lower zone  (invert → bottom): narrow trench width only
             * This creates the visible step at the invert/bench-floor level.
             * When benchWidthFt = 0, totalWidthFt = trenchWidthFt so both
             * prisms have the same width (no step rendered).
             */}
            <Prism
              seg={seg} halfWidth={model.totalWidthFt / 2}
              topA={seg.groundA} topB={seg.groundB}
              botA={seg.invertA} botB={seg.invertB}
              color={EARTH} opacity={hasBench ? 0.55 : 0.5}
            />
            <Prism
              seg={seg} halfWidth={model.trenchWidthFt / 2}
              topA={seg.invertA} topB={seg.invertB}
              botA={seg.bottomA} botB={seg.bottomB}
              color={EARTH} opacity={0.5}
            />
            <Prism
              seg={seg} halfWidth={model.trenchWidthFt / 2}
              topA={seg.invertA} topB={seg.invertB}
              botA={seg.bottomA} botB={seg.bottomB}
              color={BEDDING} opacity={0.92}
            />
          </React.Fragment>
        ))}

        <PipeRun model={model} color={run.color} additionalPipes={additionalPipes} />

        {isHDD && includePits && model.segments.length > 0 && (() => {
          const startSeg = model.segments[0];
          const endSeg = model.segments[model.segments.length - 1];
          const pitW = run.trenchWidthFt || 3.0;
          const pitL = run.benchWidthFt || 6.0;
          const startPitD = run.startDepthFt || 5.0;
          const endPitD = (model as any).endPitDepthFt ?? (startPitD / 3);

          return (
            <>
              <Pit
                x={startSeg.ax}
                ground={startSeg.groundA}
                z={startSeg.az}
                width={pitW}
                length={pitL}
                depth={startPitD}
                color="#8c6c47"
              />
              <Pit
                x={endSeg.bx}
                ground={endSeg.groundB}
                z={endSeg.bz}
                width={pitW}
                length={pitL}
                depth={endPitD}
                color="#8c6c47"
              />
            </>
          );
        })()}

        {model.structures.map((s, i) => (
          <Structure key={i} x={s.x} z={s.z} ground={s.ground} invert={s.invert} />
        ))}
      </group>

      <Grid
        position={[0, floorY, 0]}
        args={[model.radius * 6, model.radius * 6]}
        cellSize={Math.max(1, Math.round(model.radius / 5))}
        sectionSize={Math.max(5, Math.round(model.radius))}
        cellColor="#3a3f47"
        sectionColor="#555c66"
        fadeDistance={model.radius * 12}
        infiniteGrid={false}
      />

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e06666', '#93c47d', '#6fa8dc']} labelColor="#fff" />
      </GizmoHelper>
    </>
  );
}

function LegendSwatch({ color, opacity, label }: { color: string; opacity: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 12, height: 12, borderRadius: 2, flexShrink: 0,
        background: color, opacity,
        border: '1px solid rgba(255,255,255,0.15)',
      }} />
      <span>{label}</span>
    </div>
  );
}

export function Trench3DView({ run, scalePxPerFt, groundSampler, height = 520, isHDD = false, includePits = false }: Trench3DViewProps) {
  const system = useUnitSystem();
  const metric = system === 'metric';
  const [resetKey, setResetKey] = useState(0);

  const model = useMemo(() => {
    const m = buildRunGeometry(run, scalePxPerFt, groundSampler);
    if (m && isHDD) {
      const startPitD = run.startDepthFt || 5.0;
      const hasGrade = run.gradePct && run.gradePct !== 0;

      if (m.segments.length > 0) {
        const startSeg = m.segments[0];
        const endSeg = m.segments[m.segments.length - 1];

        startSeg.invertA = startSeg.groundA - startPitD;
        startSeg.bottomA = startSeg.invertA - m.beddingDepthFt;

        let endPitD = startPitD / 3;
        if (hasGrade) {
          endPitD = Math.max(endSeg.groundB - endSeg.invertB, 0.1);
        } else {
          endSeg.invertB = endSeg.groundB - endPitD;
          endSeg.bottomB = endSeg.invertB - m.beddingDepthFt;
        }
        (m as any).endPitDepthFt = endPitD;
      }

      const pipeRadiusFt = m.pipeDiaFt / 2;
      if (m.pipeCenterline.length > 0 && m.segments.length > 0) {
        m.pipeCenterline[0].y = (m.segments[0].groundA - startPitD) + pipeRadiusFt;
        m.pipeCenterline[m.pipeCenterline.length - 1].y = (m.segments[m.segments.length - 1].groundB - (m as any).endPitDepthFt) + pipeRadiusFt;
      }
    }
    return m;
  }, [run, scalePxPerFt, groundSampler, isHDD]);

  // Sits above the `!model` early return on purpose. A hook called after a
  // conditional return changes the hook count when `model` flips from null
  // (a run with no measurable length yet) to non-null — the estimator types a
  // length and React throws "Rendered more hooks than during the previous
  // render". Nothing in here reads `model`, so it belongs above the guard.
  const additionalPipes3D = useMemo(() => {
    const jsonStr = run.hddAdditionalPipesJson || run.backfillType;
    if (!jsonStr || !jsonStr.startsWith('[')) return [];
    try {
      const list = JSON.parse(jsonStr) as Array<{ pipeSizeIn: number; pipeMaterialId: number | string | null; pipeMaterial?: string }>;
      const palette = ['#3b82f6', '#f59e0b', '#06b6d4', '#8b5cf6', '#ec4899', '#f97316'];
      const sizeColorMap = new Map<string, string>();
      
      const primaryKey = (run.pipeSizeIn || 3.937).toFixed(1);
      const primaryColor = run.color || '#10b981';
      sizeColorMap.set(primaryKey, primaryColor);
      
      let paletteIdx = 0;

      return list.map((item) => {
        const sizeIn = item.pipeSizeIn || 3.937;
        const sizeKey = sizeIn.toFixed(1);
        
        if (!sizeColorMap.has(sizeKey)) {
          sizeColorMap.set(sizeKey, palette[paletteIdx % palette.length]);
          paletteIdx++;
        }

        const sizeFt = sizeIn / 12;
        return {
          radius: Math.max(sizeFt / 2, 0.05),
          color: sizeColorMap.get(sizeKey)!,
          sizeIn,
        };
      });
    } catch {
      return [];
    }
  }, [run.hddAdditionalPipesJson, run.backfillType, run.pipeSizeIn, run.color]);

  if (!model) {
    return <p className="text-muted">This run has no measurable length yet.</p>;
  }

  // Cross-section-aware camera distance. For very long runs the bounding radius
  // is dominated by plan length, leaving the narrow trench cross-section invisible
  // from the default overview. Cap so the cross-section is always legible on first
  // open; users can scroll out to see the full run.
  const maxCutDepth = Math.max(
    ...model.segments.map((s) => Math.max(s.groundA - s.bottomA, s.groundB - s.bottomB)),
    model.totalWidthFt,
    1,
  );
  const viewSize = Math.max(maxCutDepth * 1.5, model.totalWidthFt * 4, 8);
  const dist = Math.min(model.radius * 2.6, viewSize * 5);

  const hasBench = run.benchWidthFt > 0;
  const benchWidthFt = run.benchWidthFt;

  return (
    <div>
      <div style={{ position: 'relative', height, borderRadius: 6, overflow: 'hidden', background: '#0e1116' }}>
        <Canvas
          key={resetKey}
          camera={{ position: [dist * 0.6, dist * 0.4, dist * 0.6] as [number, number, number], fov: 45, near: 0.1, far: dist * 50 }}
          dpr={[1, 2]}
        >
          <color attach="background" args={['#0e1116']} />
          <Scene
            model={model}
            run={run}
            groundSampler={groundSampler}
            scalePxPerFt={scalePxPerFt}
            hasBench={hasBench}
            isHDD={isHDD}
            includePits={includePits}
            additionalPipes={additionalPipes3D}
          />
        </Canvas>

        <div style={{
          position: 'absolute', bottom: 12, left: 12,
          background: 'rgba(14,17,22,0.82)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 5, padding: '7px 10px',
          fontSize: 11, color: 'var(--text-muted)',
          display: 'flex', flexDirection: 'column', gap: 5,
          backdropFilter: 'blur(4px)',
          pointerEvents: 'none',
        }}>
          {!isHDD && (
            <>
              <LegendSwatch color={EARTH} opacity={0.85} label={hasBench
                ? `Excavation (benched ${metric ? formatQty(benchWidthFt, 'ft', system) : `${benchWidthFt}′`} ea side)`
                : 'Excavation cut'} />
              <LegendSwatch color={BEDDING} opacity={1}
                label={`Bedding (${metric ? formatQty(run.beddingDepthFt, 'ft', system) : `${run.beddingDepthFt}′`} depth)`} />
            </>
          )}
          <LegendSwatch color={run.color} opacity={1} label={isHDD ? `HDD Bore: ${formatPipeSize(run.pipeSizeIn, system)} ${run.pipeMaterial || ''}` : `${formatPipeSize(run.pipeSizeIn, system)} ${run.pipeMaterial}`} />
          {includePits && isHDD && (
            <LegendSwatch color="#8c6c47" opacity={0.5} label="Launch/Exit Pits" />
          )}
          {model.structures.length > 0 && !isHDD && (
            <LegendSwatch color={STRUCTURE} opacity={1} label="Structures" />
          )}
          {groundSampler && (
            <LegendSwatch color="#4d7a3a" opacity={0.7} label="Existing terrain" />
          )}
        </div>

        {/* Reset view button */}
        <button
          onClick={() => setResetKey((k) => k + 1)}
          title="Reset camera"
          style={{
            position: 'absolute', top: 8, left: 8,
            background: 'rgba(14,17,22,0.75)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4, color: 'var(--text-muted)',
            fontSize: 11, padding: '3px 8px', cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          Reset view
        </button>
      </div>

      <div className="flex gap-8" style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{metric ? formatQty(model.totalLengthFt, 'lf', system, 1) : `${model.totalLengthFt.toFixed(1)} LF`}</span>
        {!isHDD && (
          <>
            <span>·</span>
            <span>trench {metric ? formatQty(model.trenchWidthFt, 'ft', system) : `${model.trenchWidthFt}′`} wide</span>
            {hasBench && (
              <>
                <span>·</span>
                <span>
                  bench {metric ? formatQty(benchWidthFt, 'ft', system) : `${benchWidthFt}′`} each side
                  {' → '}{metric ? formatQty(model.totalWidthFt, 'ft', system) : `${model.totalWidthFt}′`} total cut
                </span>
              </>
            )}
          </>
        )}
        <span>·</span>
        <span>true 1:1 scale</span>
        <span>·</span>
        <span>drag to orbit · scroll to zoom</span>
        {model.mode === 'depth' && !isHDD && (
          <>
            <span>·</span>
            <span>depths estimated from start depth + grade</span>
          </>
        )}
      </div>
    </div>
  );
}
