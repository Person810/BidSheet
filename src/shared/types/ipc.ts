/**
 * IPC contract types — the shapes that actually cross the preload bridge.
 *
 * Three families:
 *  - *Row:      raw SQLite rows (snake_case, matching the schema in database.ts)
 *  - *DTO:      camelCase shapes the takeoff handlers map rows into
 *  - Save*:     payloads the save handlers read off their argument
 *
 * window.d.ts types every window.api method with these, so a schema change
 * that isn't reflected here (and at the call sites) fails `npm run typecheck`
 * instead of silently returning undefined at runtime.
 */

import type { FullBidSummary } from '../bidCalc';
import type { CrewTemplate } from './labor';

/** Result of a bare better-sqlite3 .run() forwarded over IPC. */
export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

// ================================================================
// Catalog rows
// ================================================================

export interface MaterialCategoryRow {
  id: number;
  name: string;
  description: string | null;
}

export interface MaterialRow {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  unit: string;
  default_unit_cost: number;
  supplier: string | null;
  part_number: string | null;
  last_price_update: string;
  notes: string | null;
  is_active: number;
  aliases: string | null;
  tons_per_cy: number | null;
  cost_per_cy: number | null;
}

export interface MaterialWithCategoryRow extends MaterialRow {
  category_name: string;
}

export interface SaveMaterialPayload {
  id?: number;
  categoryId: number;
  name: string;
  description?: string | null;
  unit: string;
  defaultUnitCost: number;
  supplier?: string | null;
  partNumber?: string | null;
  notes?: string | null;
  aliases?: string | null;
  isActive?: boolean | number;
  tonsPerCy?: number | null;
  costPerCy?: number | null;
}

export interface SaveLaborRolePayload {
  id?: number;
  name: string;
  defaultHourlyRate: number;
  burdenMultiplier: number;
  notes?: string | null;
  aliases?: string | null;
}

export interface SaveCrewTemplatePayload {
  id?: number;
  name: string;
  description?: string | null;
  members: { laborRoleId: number; quantity: number }[];
}

export interface ProductionRateRow {
  id: number;
  description: string;
  crew_template_id: number;
  unit: string;
  rate_per_hour: number;
  conditions: string | null;
  notes: string | null;
  aliases: string | null;
  /** Joined from crew_templates */
  crew_name: string;
}

export interface SaveProductionRatePayload {
  id?: number;
  description: string;
  crewTemplateId: number;
  unit: string;
  ratePerHour: number;
  conditions?: string | null;
  notes?: string | null;
}

export interface EquipmentRow {
  id: number;
  name: string;
  category: string;
  hourly_rate: number;
  daily_rate: number | null;
  mobilization_cost: number;
  fuel_cost_per_hour: number | null;
  notes: string | null;
  is_owned: number;
  is_active: number;
  aliases: string | null;
}

export interface SaveEquipmentPayload {
  id?: number;
  name: string;
  category: string;
  hourlyRate: number;
  dailyRate?: number | null;
  mobilizationCost: number;
  fuelCostPerHour?: number | null;
  notes?: string | null;
  aliases?: string | null;
  isOwned?: boolean | number;
  isActive?: boolean | number;
}

// ================================================================
// Jobs / bids
// ================================================================

export type JobStatus = 'draft' | 'submitted' | 'won' | 'lost' | 'archived';

export interface JobRow {
  id: number;
  name: string;
  job_number: string | null;
  client: string;
  location: string | null;
  bid_date: string | null;
  start_date: string | null;
  description: string | null;
  status: JobStatus;
  overhead_percent: number;
  profit_percent: number;
  bond_percent: number | null;
  tax_percent: number | null;
  escalation_percent: number;
  notes: string | null;
  bid_locked: number;
  parent_job_id: number | null;
  change_order_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface SaveJobPayload {
  id?: number;
  name: string;
  jobNumber?: string | null;
  client: string;
  location?: string | null;
  bidDate?: string | null;
  startDate?: string | null;
  description?: string | null;
  status: JobStatus;
  overheadPercent: number;
  profitPercent: number;
  bondPercent?: number | null;
  taxPercent?: number | null;
  escalationPercent?: number | null;
  notes?: string | null;
  bidLocked?: boolean | number;
  parentJobId?: number | null;
  changeOrderNumber?: number | null;
}

export interface BidSectionRow {
  id: number;
  job_id: number;
  name: string;
  sort_order: number;
  is_alternate: number;
  overhead_percent_override: number | null;
  profit_percent_override: number | null;
  bond_percent_override: number | null;
}

export interface SaveBidSectionPayload {
  id?: number;
  jobId?: number;
  name: string;
  sortOrder: number;
  isAlternate?: boolean | number;
  overheadPercentOverride?: number | null;
  profitPercentOverride?: number | null;
  bondPercentOverride?: number | null;
}

export interface BidLineItemRow {
  id: number;
  section_id: number;
  job_id: number;
  description: string;
  quantity: number;
  unit: string;
  sort_order: number;
  material_id: number | null;
  material_unit_cost: number;
  material_total: number;
  crew_template_id: number | null;
  production_rate_id: number | null;
  labor_hours: number;
  labor_cost_per_hour: number;
  labor_total: number;
  equipment_id: number | null;
  equipment_cost_per_hour: number;
  equipment_hours: number;
  equipment_total: number;
  subcontractor_cost: number;
  unit_cost: number;
  total_cost: number;
  notes: string | null;
  item_number: string | null;
  cost_code: string | null;
}

export interface SaveBidLineItemPayload {
  id?: number;
  sectionId: number;
  jobId: number;
  description: string;
  quantity: number;
  unit: string;
  sortOrder: number;
  materialId?: number | null;
  materialUnitCost: number;
  crewTemplateId?: number | null;
  productionRateId?: number | null;
  laborHours: number;
  laborCostPerHour: number;
  equipmentId?: number | null;
  equipmentCostPerHour: number;
  equipmentHours: number;
  subcontractorCost?: number;
  notes?: string | null;
  itemNumber?: string | null;
  costCode?: string | null;
}

/** Summary returned by db:jobs:summary / summary-batch (bidCalc + jobId). */
export type JobBidSummary = FullBidSummary & { jobId: number };

/** One unpriced row scaffolded from an owner's bid schedule. */
export interface BidItemImportRow {
  description: string;
  quantity: number;
  unit: string;
  itemNumber: string | null;
}

export interface QuoteRow {
  id: number;
  job_id: number;
  scope: string;
  vendor: string;
  contact: string;
  amount: number;
  quote_date: string | null;
  notes: string | null;
  is_selected: number;
  created_at: string;
}

export interface SaveQuotePayload {
  id?: number;
  jobId?: number;
  scope: string;
  vendor: string;
  contact?: string | null;
  amount?: number;
  quoteDate?: string | null;
  notes?: string | null;
}

export interface TrenchProfileRow {
  id: number;
  job_id: number;
  label: string;
  pipe_size_in: number;
  pipe_material: string;
  start_depth_ft: number;
  grade_pct: number;
  run_length_lf: number;
  trench_width_ft: number;
  bench_width_ft: number;
  bedding_type: string;
  backfill_type: string;
  sort_order: number;
  pipe_material_id: number | null;
  bedding_material_id: number | null;
  backfill_material_id: number | null;
  bedding_depth_ft: number;
  created_at: string;
  updated_at: string;
}

export interface SaveTrenchProfilePayload {
  id?: number;
  jobId?: number;
  label?: string | null;
  pipeSizeIn: number;
  pipeMaterial?: string | null;
  startDepthFt: number;
  gradePct: number;
  runLengthLF: number;
  trenchWidthFt: number;
  benchWidthFt: number;
  beddingType?: string | null;
  backfillType?: string | null;
  sortOrder?: number;
  /** String pseudo-IDs like 'native' are stored as NULL */
  pipeMaterialId?: number | string | null;
  beddingMaterialId?: number | string | null;
  backfillMaterialId?: number | string | null;
  beddingDepthFt?: number;
}

// ================================================================
// Assemblies
// ================================================================

export interface AssemblyItemRow {
  id: number;
  assembly_id: number;
  material_id: number;
  quantity: number;
  notes: string | null;
  /** Joined from materials */
  material_name: string;
  material_unit: string;
  material_unit_cost: number;
}

export interface AssemblyRow {
  id: number;
  name: string;
  description: string | null;
  unit: string;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  production_rate_id: number | null;
  crew_template_id: number | null;
  equipment_id: number | null;
  equipment_hours_per_unit: number;
  /** Joined labels (list handler only; null when unset) */
  production_rate_desc?: string | null;
  production_rate_per_hour?: number | null;
  crew_name?: string | null;
  equipment_name?: string | null;
  equipment_hourly_rate?: number | null;
  items: AssemblyItemRow[];
}

export interface SaveAssemblyPayload {
  id?: number;
  name: string;
  description?: string | null;
  unit: string;
  notes?: string | null;
  productionRateId?: number | null;
  crewTemplateId?: number | null;
  equipmentId?: number | null;
  equipmentHoursPerUnit?: number;
  items: { materialId: number; quantity: number; notes?: string | null }[];
}

// ================================================================
// Settings / setup / CSV import
// ================================================================

export interface AppSettingsRow {
  id: number;
  company_name: string;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_logo: string | null;
  company_tagline: string | null;
  default_overhead_percent: number;
  default_profit_percent: number;
  default_tax_percent: number;
  default_bond_percent: number;
  setup_complete: number;
  trade_types: string | null;
  auto_lock_on_close: number;
  last_backup_schema_version: number;
  local_only_mode: number;
}

export interface SaveSettingsPayload {
  companyName: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyTagline?: string | null;
  companyLogo?: string | null;
  defaultOverheadPercent: number;
  defaultProfitPercent: number;
  defaultTaxPercent: number;
  defaultBondPercent: number;
  autoLockOnClose?: boolean | number;
  localOnlyMode?: boolean | number;
}

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
  error?: string;
}

export interface PriceImportUpdate {
  materialId: number;
  newPrice: number;
  supplier?: string;
  partNumber?: string;
}

export interface PriceImportResult {
  updated: number;
  skipped: number;
  error?: string;
}

export interface FileExportResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface BackupReminderStatus {
  needed: boolean;
  currentVersion: number;
  lastBackupVersion: number;
}

// ================================================================
// Plan takeoff
// ================================================================

export type UtilityType = 'sanitary' | 'storm' | 'water' | 'fiber' | 'other';
export type AreaType = 'asphalt' | 'concrete' | 'gravel' | 'topsoil' | 'other';
export type AnnotationKind = 'text' | 'arrow' | 'cloud';

export interface TakeoffJobSettingsRow {
  id: number;
  job_id: number;
  pdf_path: string | null;
  scale_px_per_ft: number | null;
  scale_point1_x: number | null;
  scale_point1_y: number | null;
  scale_point2_x: number | null;
  scale_point2_y: number | null;
  scale_distance_ft: number | null;
  created_at: string;
  updated_at: string;
}

/** Upsert payload — named SQL params, so every key must be present. */
export interface SaveTakeoffSettingsPayload {
  job_id: number;
  pdf_path: string | null;
  scale_px_per_ft: number | null;
  scale_point1_x: number | null;
  scale_point1_y: number | null;
  scale_point2_x: number | null;
  scale_point2_y: number | null;
  scale_distance_ft: number | null;
}

export interface PageScaleRow {
  id: number;
  job_id: number;
  page_number: number;
  scale_px_per_ft: number;
  scale_point1_x: number | null;
  scale_point1_y: number | null;
  scale_point2_x: number | null;
  scale_point2_y: number | null;
  scale_distance_ft: number | null;
}

/** Upsert payload — named SQL params, so every key must be present. */
export type SavePageScalePayload = Omit<PageScaleRow, 'id'>;

export interface PageScaleListEntry {
  page_number: number;
  scale_px_per_ft: number;
}

export interface TakeoffVertexDTO {
  x: number;
  y: number;
  invertElev?: number | null;
  rimElev?: number | null;
  structureType?: string | null;
  nodeId?: number | null;
}

export interface TakeoffRunDTO {
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
  points: TakeoffVertexDTO[];
}

export interface SaveTakeoffRunPayload extends Omit<TakeoffRunDTO, 'id'> {
  /** Omit or pass <= 0 to insert; positive to update */
  id?: number;
  jobId?: number;
  sortOrder?: number;
}

export interface TakeoffNodeDTO {
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

export interface TakeoffItemDTO {
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

export interface TakeoffAreaDTO {
  id: number;
  jobId: number;
  label: string;
  areaType: AreaType;
  depthFt: number;
  materialId: number | null;
  assemblyId: number | null;
  color: string;
  pdfPage: number;
  points: { x: number; y: number }[];
}

export interface SaveTakeoffAreaPayload extends Omit<TakeoffAreaDTO, 'id'> {
  id?: number;
  sortOrder?: number;
}

export interface TakeoffAnnotationDTO {
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

/** Full per-job takeoff state, restored transactionally for undo/redo. */
export interface TakeoffStateSnapshot {
  runs: TakeoffRunDTO[];
  nodes: TakeoffNodeDTO[];
  items: TakeoffItemDTO[];
  areas: TakeoffAreaDTO[];
  annotations: TakeoffAnnotationDTO[];
}

// ================================================================
// Updater
// ================================================================

export interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  percent?: number;
  error?: string;
}
