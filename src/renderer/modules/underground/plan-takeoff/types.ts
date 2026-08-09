// Wire-format unions are defined once in the IPC contract so the renderer
// state and what crosses the bridge can't drift apart.
import type { AnnotationKind, AreaType, GradeMode, SurfaceKind, UtilityType } from '../../../../shared/types/ipc';

export type { AnnotationKind, AreaType, GradeMode, SurfaceKind, UtilityType };

export interface TakeoffJobSettings {
  id?: number;
  job_id: number;
  pdf_path: string | null;
  /** Legacy job-level scale (superseded by per-page scales, still stored) */
  scale_px_per_ft?: number | null;
  scale_point1_x?: number | null;
  scale_point1_y?: number | null;
  scale_point2_x?: number | null;
  scale_point2_y?: number | null;
  scale_distance_ft?: number | null;
}

/** Per-page scale calibration data */
export interface PageScale {
  job_id: number;
  page_number: number;
  scale_px_per_ft: number;
  scale_point1_x: number | null;
  scale_point1_y: number | null;
  scale_point2_x: number | null;
  scale_point2_y: number | null;
  scale_distance_ft: number | null;
}

export interface PdfPoint {
  x: number; // PDF-native x coordinate (at scale=1)
  y: number; // PDF-native y coordinate (at scale=1)
}

/** A vertex in a takeoff run — extends PdfPoint with optional elevation data */
export interface TakeoffVertex extends PdfPoint {
  invertElev?: number | null;
  rimElev?: number | null;
  structureType?: string | null;
  /** When set, this vertex is linked to a shared junction node */
  nodeId?: number | null;
}

/**
 * A shared junction node (manhole, cleanout, tee, etc.) that can be
 * referenced by vertices across multiple runs.
 *
 * ID convention: same as TakeoffRun (negative = local-only, positive = DB).
 */
export interface TakeoffNode {
  id: number;
  jobId: number;
  xPx: number;
  yPx: number;
  pdfPage: number;
  invertElev: number | null;
  rimElev: number | null;
  structureType: string | null;
  label: string;
}

/** Interaction mode for the drawing overlay */
export type OverlayMode = 'none' | 'calibrate-p1' | 'calibrate-p2' | 'draw';


/**
 * A single pipe run on the plan.
 *
 * ID convention:
 *   negative = local-only (not yet saved to DB)
 *   positive = DB-assigned (INTEGER PRIMARY KEY AUTOINCREMENT)
 */
export interface TakeoffRun {
  id: number;
  label: string;
  utilityType: UtilityType;
  pipeSizeIn: number;
  pipeMaterial: string;
  pipeMaterialId: number | null;
  startDepthFt: number;
  gradePct: number;
  trenchWidthFt: number;
  benchWidthFt: number;
  beddingType: string;
  beddingDepthFt: number;
  beddingMaterialId: number | null;
  backfillType: string;
  backfillMaterialId: number | null;
  color: string;
  pdfPage: number;
  points: TakeoffVertex[];
  hddAdditionalPipesJson?: string | null;
}

/** Config fields shared between new-run and edit-run modals */
export interface RunConfig {
  label: string;
  utilityType: UtilityType;
  pipeSizeIn: number;
  pipeMaterial: string;
  pipeMaterialId: number | null;
  hddAdditionalPipesJson?: string | null;
  startDepthFt: number;
  gradePct: number;
  trenchWidthFt: number;
  benchWidthFt: number;
  beddingType: string;
  beddingDepthFt: number;
  beddingMaterialId: number | null;
  backfillType: string;
  backfillMaterialId: number | null;
}

/**
 * A single count item (fitting, structure, valve, etc.) placed on the plan.
 *
 * ID convention: same as TakeoffRun (negative = local-only, positive = DB).
 */
export interface TakeoffItem {
  id: number;
  jobId: number;
  materialId: number | null;
  materialName: string;
  xPx: number;
  yPx: number;
  quantity: number;
  label: string;
  pdfPage: number;
  nearRunId: number | null;
}


/**
 * A measured surface area polygon (pavement patch, restoration, grading limits).
 *
 * ID convention: same as TakeoffRun (negative = local-only, positive = DB).
 */
export interface TakeoffArea {
  id: number;
  jobId: number;
  label: string;
  areaType: AreaType;
  /** Depth of the surface course in feet (0 = area-only, no volume) */
  depthFt: number;
  materialId: number | null;
  /** When set, Send to Bid expands this assembly per measured SY instead of a single material line */
  assemblyId: number | null;
  color: string;
  pdfPage: number;
  /** When set, this area is an earthwork region (cut/fill) rather than surface restoration. */
  gradeMode?: GradeMode | null;
  /** Depth (cut/fill modes) or finished elevation (finished_elev), in feet. */
  gradeValueFt?: number | null;
  points: PdfPoint[];
}

/** Config fields shared between new-area and edit-area modals */
export interface AreaConfig {
  label: string;
  areaType: AreaType;
  depthFt: number;
  materialId: number | null;
  assemblyId: number | null;
  gradeMode?: GradeMode | null;
  gradeValueFt?: number | null;
}

/**
 * A measured wall run — an open polyline traced on the plan with a height,
 * thickness, and formed/finished-face count, so it expands to surface area,
 * volume, and (optionally) a count of vertical members. Trade-agnostic: works
 * for concrete, framing, masonry, etc. — the linked material/assembly defines
 * what gets billed.
 *
 * ID convention: same as TakeoffRun (negative = local-only, positive = DB).
 */
export interface TakeoffWall {
  id: number;
  jobId: number;
  label: string;
  heightFt: number;
  thicknessIn: number;
  faces: number;          // 1 or 2 finished/formed faces
  memberSpacingIn: number; // vertical members (studs/bars/posts) o.c.; 0 = none
  materialId: number | null;
  assemblyId: number | null;
  color: string;
  pdfPage: number;
  points: PdfPoint[];
}

/** Config fields shared between new-wall and edit-wall modals */
export interface WallConfig {
  label: string;
  heightFt: number;
  thicknessIn: number;
  faces: number;
  memberSpacingIn: number;
  materialId: number | null;
  assemblyId: number | null;
}

export const WALL_COLOR = '#6D4C41';

/** A single surveyed elevation point on a job surface (PDF px + elevation ft). */
export interface SurfacePoint {
  x: number;       // PDF-native px (at scale=1)
  y: number;
  z: number;       // elevation, feet
  pdfPage: number;
}

/**
 * An elevation surface for a job — a set of spot elevations that build into a
 * TIN for cut/fill and for grounding pipe runs against real terrain.
 *
 * ID convention: same as TakeoffRun (negative = local-only, positive = DB).
 */
export interface TakeoffSurface {
  id: number;
  jobId: number;
  kind: SurfaceKind;
  name: string;
  points: SurfacePoint[];
}


/**
 * A plan markup: a text note (x1,y1), an arrow (x1,y1 → x2,y2), or a
 * revision cloud over the rectangle (x1,y1)-(x2,y2).
 *
 * ID convention: same as TakeoffRun (negative = local-only, positive = DB).
 */
export interface TakeoffAnnotation {
  id: number;
  jobId: number;
  pdfPage: number;
  kind: AnnotationKind;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  text: string;
  color: string;
}

export const ANNOTATION_COLOR = '#EF4444';

export interface ContextMenuState {
  x: number;
  y: number;
  targetType: 'vertex' | 'segment' | 'fitting' | 'countItem' | 'area' | 'annotation' | 'canvas';
  targetId: number | null;       // run ID, item ID, area ID, or annotation ID
  targetData: {
    vertexIndex?: number;
    segmentIndex?: number;
    pdfPoint?: PdfPoint;
    nodeId?: number | null;
  };
}

export const UTILITY_COLORS: Record<UtilityType, string> = {
  sanitary: '#4CAF50',
  storm: '#FF9800',
  water: '#2196F3',
  fiber: '#9C27B0',
  other: '#607D8B',
};

export const AREA_COLORS: Record<AreaType, string> = {
  asphalt: '#455A64',
  concrete: '#90A4AE',
  gravel: '#A1887F',
  topsoil: '#8BC34A',
  other: '#BA68C8',
};

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  asphalt: 'Asphalt',
  concrete: 'Concrete',
  gravel: 'Gravel',
  topsoil: 'Topsoil / Seeding',
  other: 'Other',
};
