export interface TakeoffJobSettings {
  id?: number;
  job_id: number;
  pdf_path: string | null;
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

export type UtilityType = 'sanitary' | 'storm' | 'water' | 'fiber' | 'other';

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
}

/** Config fields shared between new-run and edit-run modals */
export interface RunConfig {
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

export type AreaType = 'asphalt' | 'concrete' | 'gravel' | 'topsoil' | 'other';

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
  points: PdfPoint[];
}

/** Config fields shared between new-area and edit-area modals */
export interface AreaConfig {
  label: string;
  areaType: AreaType;
  depthFt: number;
  materialId: number | null;
  assemblyId: number | null;
}

export interface ContextMenuState {
  x: number;
  y: number;
  targetType: 'vertex' | 'segment' | 'fitting' | 'countItem' | 'area' | 'canvas';
  targetId: number | null;       // run ID, item ID, or area ID
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
