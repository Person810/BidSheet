export interface TakeoffJobSettings {
  id?: number;
  job_id: number;
  pdf_path: string | null;
  scale_px_per_ft: number | null;
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

/** Interaction mode for the drawing overlay */
export type OverlayMode = 'none' | 'calibrate-p1' | 'calibrate-p2' | 'draw' | 'place-item';

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
  points: PdfPoint[];
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

export const UTILITY_COLORS: Record<UtilityType, string> = {
  sanitary: '#4CAF50',
  storm: '#FF9800',
  water: '#2196F3',
  fiber: '#9C27B0',
  other: '#607D8B',
};
