import React, { useMemo } from 'react';
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
  /** Existing-ground sampler so the trench follows real terrain. */
  groundSampler?: GroundSampler;
  /** Plot height in CSS px (width fills the container) */
  height?: number;
}

const EARTH = '#8a6d3b';
const BEDDING = '#b8a06a';
const STRUCTURE = '#9aa0a6';

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
        roughness={0.95}
        metalness={0}
      />
    </mesh>
  );
}

/** Pipe swept along the invert centerline as a tube. */
function Pipe({ model, color }: { model: Trench3DModel; color: string }) {
  const geometry = useMemo(() => {
    const pts = model.pipeCenterline.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    if (pts.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const radius = Math.max(model.pipeDiaFt / 2, 0.05);
    const tubular = Math.max(8, model.pipeCenterline.length * 8);
    return new THREE.TubeGeometry(curve, tubular, radius, 16, false);
  }, [model]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
    </mesh>
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

function Scene({ model, run }: { model: Trench3DModel; run: TakeoffRun }) {
  // Recenter the model on the world origin so orbit/zoom stays well-behaved.
  const offset: [number, number, number] = [-model.center.x, -model.center.y, -model.center.z];
  const floorY = model.center.y - model.radius; // a touch below the deepest point

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[model.radius, model.radius * 2, model.radius]} intensity={1.1} castShadow />
      <directionalLight position={[-model.radius, model.radius, -model.radius]} intensity={0.3} />

      <group position={offset}>
        {model.segments.map((seg, i) => (
          <React.Fragment key={i}>
            {/* Excavation envelope: ground -> trench bottom, full benched width */}
            <Prism
              seg={seg} halfWidth={model.totalWidthFt / 2}
              topA={seg.groundA} topB={seg.groundB}
              botA={seg.bottomA} botB={seg.bottomB}
              color={EARTH} opacity={0.22}
            />
            {/* Bedding zone: trench bottom -> invert, nominal trench width */}
            <Prism
              seg={seg} halfWidth={model.trenchWidthFt / 2}
              topA={seg.invertA} topB={seg.invertB}
              botA={seg.bottomA} botB={seg.bottomB}
              color={BEDDING} opacity={0.9}
            />
          </React.Fragment>
        ))}

        <Pipe model={model} color={run.color} />

        {model.structures.map((s, i) => (
          <Structure key={i} x={s.x} z={s.z} ground={s.ground} invert={s.invert} />
        ))}
      </group>

      {/* Reference grid for scale/orientation, recentered with the model */}
      <Grid
        position={[0, floorY - model.center.y, 0]}
        args={[model.radius * 6, model.radius * 6]}
        cellSize={Math.max(1, Math.round(model.radius / 5))}
        sectionSize={Math.max(5, Math.round(model.radius))}
        cellColor="#3a3f47"
        sectionColor="#555c66"
        fadeDistance={model.radius * 12}
        infiniteGrid={false}
      />

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e06666', '#93c47d', '#6fa8dc']} labelColor="#fff" />
      </GizmoHelper>
    </>
  );
}

/**
 * Interactive 3D view of a pipe run's ditchwork: the excavation envelope,
 * bedding zone, sloped pipe, and structures, swept along the drawn plan path.
 * Orbit/pan/zoom via the mouse. Elevations come from the same profile model
 * as the 2D side view, drawn here at true 1:1 scale.
 */
export function Trench3DView({ run, scalePxPerFt, groundSampler, height = 460 }: Trench3DViewProps) {
  const model = useMemo(() => buildRunGeometry(run, scalePxPerFt, groundSampler), [run, scalePxPerFt, groundSampler]);

  if (!model) {
    return <p className="text-muted">This run has no measurable length yet.</p>;
  }

  const dist = model.radius * 2.6;

  return (
    <div>
      <div style={{ height, borderRadius: 6, overflow: 'hidden', background: '#0e1116' }}>
        <Canvas
          camera={{ position: [dist * 0.7, dist * 0.7, dist * 0.7], fov: 45, near: 0.1, far: dist * 50 }}
          dpr={[1, 2]}
        >
          <color attach="background" args={['#0e1116']} />
          <Scene model={model} run={run} />
        </Canvas>
      </div>

      <div className="flex gap-8" style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{run.pipeSizeIn}" {run.pipeMaterial}</span>
        <span>·</span>
        <span>{model.totalLengthFt.toFixed(1)} LF</span>
        <span>·</span>
        <span>trench {model.trenchWidthFt}' / dig {model.totalWidthFt}'</span>
        <span>·</span>
        <span>true 1:1 scale · drag to orbit, scroll to zoom</span>
        {model.mode === 'depth' && (
          <>
            <span>·</span>
            <span>depths from start depth + design grade (no surveyed inverts)</span>
          </>
        )}
      </div>
    </div>
  );
}
