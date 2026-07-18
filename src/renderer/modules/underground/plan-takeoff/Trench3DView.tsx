import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { TakeoffRun } from './types';
import type { GroundSampler } from './profileModel';
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
function PipeRun({ model, color }: { model: Trench3DModel; color: string }) {
  const radius = Math.max(model.pipeDiaFt / 2, 0.05);
  const cl = model.pipeCenterline;

  return (
    <>
      {cl.map((pt, i) => {
        if (i === 0) return null;
        return (
          <PipeSegment key={i} from={cl[i - 1]} to={pt} radius={radius} color={color} />
        );
      })}
      {/* Fitting ball at each interior vertex */}
      {cl.slice(1, -1).map((pt, i) => (
        <mesh key={i} position={[pt.x, pt.y, pt.z]}>
          <sphereGeometry args={[radius * 1.18, 14, 10]} />
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
        </mesh>
      ))}
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

function Scene({ model, run, groundSampler, scalePxPerFt, hasBench }: {
  model: Trench3DModel; run: TakeoffRun;
  groundSampler?: GroundSampler; scalePxPerFt: number;
  hasBench: boolean;
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
        {model.segments.map((seg, i) => (
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

        <PipeRun model={model} color={run.color} />

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

export function Trench3DView({ run, scalePxPerFt, groundSampler, height = 520 }: Trench3DViewProps) {
  const [resetKey, setResetKey] = useState(0);

  const model = useMemo(
    () => buildRunGeometry(run, scalePxPerFt, groundSampler),
    [run, scalePxPerFt, groundSampler],
  );

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
          // Lower elevation (≈25°) so cross-section side faces are clearly visible
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
          />
        </Canvas>

        {/* Legend */}
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
          <LegendSwatch color={EARTH} opacity={0.85} label={hasBench ? `Excavation (benched ${benchWidthFt}′ ea side)` : 'Excavation cut'} />
          <LegendSwatch color={BEDDING} opacity={1} label={`Bedding (${run.beddingDepthFt}′ depth)`} />
          <LegendSwatch color={run.color} opacity={1} label={`${run.pipeSizeIn}" ${run.pipeMaterial}`} />
          {model.structures.length > 0 && (
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
        <span>{model.totalLengthFt.toFixed(1)} LF</span>
        <span>·</span>
        <span>trench {model.trenchWidthFt}′ wide</span>
        {hasBench && (
          <>
            <span>·</span>
            <span>bench {benchWidthFt}′ each side → {model.totalWidthFt}′ total cut</span>
          </>
        )}
        <span>·</span>
        <span>true 1:1 scale</span>
        <span>·</span>
        <span>drag to orbit · scroll to zoom</span>
        {model.mode === 'depth' && (
          <>
            <span>·</span>
            <span>depths estimated from start depth + grade</span>
          </>
        )}
      </div>
    </div>
  );
}
