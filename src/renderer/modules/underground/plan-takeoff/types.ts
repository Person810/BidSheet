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
export type OverlayMode = 'none' | 'calibrate-p1' | 'calibrate-p2' | 'draw';
