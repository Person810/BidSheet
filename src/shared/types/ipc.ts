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

export interface SaveMaterialCategoryPayload {
  id?: number;
  name: string;
  description?: string | null;
}

export interface MaterialCategoryUsage {
  categoryId: number;
  materialCount: number;
}

export interface MaterialCategoryManagementRow extends MaterialCategoryRow {
  materialCount: number;
}

export interface DeleteMaterialCategoryPayload {
  categoryId: number;
  replacementCategoryId: number | null;
  expectedMaterialCount: number;
}

export interface DeleteMaterialCategoryResult {
  deletedCategoryId: number;
  replacementCategoryId: number | null;
  reassignedMaterialCount: number;
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
  client_id: number | null;
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
  freight?: number;
  site_postcode?: string | null;
  site_country?: string | null;
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
  freight?: number | null;
  sitePostcode?: string | null;
  siteCountry?: string | null;
}

export interface ClientRow {
  id: number;
  name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  is_active: number;
  uuid: string;
  created_at: string;
  updated_at: string;
  /** Present on db:clients:list rows (top-level jobs linked to this client). */
  job_count?: number;
}

export interface SaveClientPayload {
  /** Omit to upsert by name (the job form's path — it never tracks ids). */
  id?: number;
  name: string;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
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
  /** Price-state system (§4): seed | past_price | quoted | confirmed. */
  price_state: PriceState;
  /** Where the current price came from, e.g. "Core & Main, job #1142, Jun 2026". */
  price_source: string | null;
  /** JSON array of derived fields the user has manually overridden (§5). */
  manual_fields: string | null;
}

export type PriceState = 'seed' | 'past_price' | 'quoted' | 'confirmed';

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
  /** Derived fields the user has overridden; persisted to skip recompute (§5). */
  manualFields?: string[];
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

export interface IndirectCostRow {
  id: number;
  job_id: number;
  description: string;
  amount: number;
  sort_order: number;
  uuid: string | null;
  created_at: string;
}

export interface SaveIndirectCostPayload {
  id?: number;
  jobId?: number;
  description: string;
  amount: number;
  sortOrder?: number;
}

export interface JobDocumentRow {
  id: number;
  job_id: number;
  /** Original display name of the attached file */
  filename: string;
  /** Unique name inside the job's managed folder */
  stored_name: string;
  /** Legacy fixed-category tag, superseded by folder_id; unused by current UI. */
  category: string;
  /** The folder this document sits in; NULL = job root. */
  folder_id: number | null;
  size_bytes: number;
  sha256: string;
  notes: string | null;
  uuid: string | null;
  added_at: string;
}

export interface AddDocumentsResult {
  added: number;
  /** Files whose content already exists on this job (same sha256) */
  skippedDuplicates: number;
  /** Basenames that could not be read or copied */
  failed: string[];
}

export interface JobDocumentFolderDTO {
  id: number;
  job_id: number;
  parent_id: number | null;
  name: string;
  sort_order: number;
  uuid: string | null;
  created_at: string;
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
  method?: string; // 'open_cut' | 'hdd'
  hdd_location?: string | null;
  hdd_include_slurry?: number | null;
  hdd_include_pits?: number | null;
  hdd_margin_pct?: number | null;
  hdd_bores_per_pit?: number | null;
  hdd_additional_pipes_json?: string | null;
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
  /** Extra loose material % on imported bedding/backfill (0 = off) */
  compactionPct?: number;
  method?: string; // 'open_cut' | 'hdd'
  hddLocation?: string | null;
  hddIncludeSlurry?: boolean | null;
  hddIncludePits?: boolean | null;
  hddMarginPct?: number | null;
  hddBoresPerPit?: number | null;
  hddAdditionalPipesJson?: string | null;
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
  job_number_auto: number;
  job_number_format: string;
  job_number_start: number;
  unit_system: string;
  /** Hand-picked sidebar tools (comma-separated ids); null = follow trades. */
  enabled_tools: string | null;
  /** Free-text trades with no seed catalog (comma-separated); null = none. */
  custom_trades: string | null;
  hdd_rates_json?: string | null;
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
  jobNumberAuto?: boolean | number;
  jobNumberFormat?: string;
  jobNumberStart?: number;
  unitSystem?: 'imperial' | 'metric';
  /** Comma-separated tool ids, '' for none, null to go back to trades. */
  enabledTools?: string | null;
  /** Comma-separated free-text trade names, null for none. */
  customTrades?: string | null;
  hddRatesJson?: string | null;
}

/** Setup-wizard answers that don't affect which catalog gets seeded. */
export interface SetupExtras {
  /** Comma-separated tool ids, '' for none, null to follow the trades. */
  enabledTools?: string | null;
  /** Comma-separated free-text trade names, null for none. */
  customTrades?: string | null;
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

export interface MaterialPriceImportCommonAction {
  rowIndex: number;
  name: string;
  unitCost: number | null;
  unit: string;
  supplier: string | null;
  partNumber: string | null;
  description: string | null;
  categoryText: string | null;
}

export interface MaterialPriceImportUpdateAction
  extends MaterialPriceImportCommonAction {
  action: 'update';
  targetMaterialId: number;
  acknowledgeUnitMismatch: boolean;
}

export interface MaterialPriceImportCreateAction
  extends MaterialPriceImportCommonAction {
  action: 'create';
  categoryId: number | null;
}

export interface MaterialPriceImportIgnoreAction
  extends MaterialPriceImportCommonAction {
  action: 'ignore';
  reason: 'user' | 'invalid';
}

export type MaterialPriceImportAction =
  | MaterialPriceImportUpdateAction
  | MaterialPriceImportCreateAction
  | MaterialPriceImportIgnoreAction;

export interface MaterialPriceImportRequest {
  source: string;
  rows: MaterialPriceImportAction[];
}

export interface MaterialPriceImportResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  ignored: number;
  invalid: number;
  error?: string;
}

// ================================================================
// Per-job price import (§1–4)
// ================================================================

/** A bid line, with linked-material context, for the reconciliation screen. */
export interface PriceImportLineRow {
  id: number;
  section_id: number;
  description: string;
  unit: string | null;
  quantity: number;
  material_id: number | null;
  material_unit_cost: number;
  price_state: PriceState;
  price_source: string | null;
  material_name: string | null;
  material_unit: string | null;
  material_supplier: string | null;
  material_part_number: string | null;
  material_aliases: string | null;
}

export interface PriceImportAliasRow {
  supplier: string;
  raw_description: string;
  material_id: number | null;
  part_number: string | null;
}

export interface PriceImportJobRow {
  id: number;
  name: string;
  job_number: string | null;
  status: string;
}

export interface PriceImportContext {
  lines: PriceImportLineRow[];
  aliases: PriceImportAliasRow[];
  sections: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  /** Open, non-locked jobs the prices can also be pushed into (current job excluded). */
  otherJobs: PriceImportJobRow[];
}

export interface PriceImportCommitRow {
  supplier: string;
  description: string;
  unit: string | null;
  price: number;
  partNumber: string | null;
  action: 'update' | 'create' | 'skip';
  targetLineId?: number | null;
  targetMaterialId?: number | null;
  newCategoryId?: number | null;
  newSectionId?: number | null;
}

export interface PriceImportCommitPayload {
  source: string;
  rows: PriceImportCommitRow[];
  /** Other open/non-locked job ids to also push prices into (matched by material). */
  applyToJobIds?: number[];
}

export interface PriceStateCounts {
  seed: number;
  past_price: number;
  quoted: number;
  confirmed: number;
  total: number;
}

export interface PriceImportCommitResult {
  rawStored: number;
  updatedLines: number;
  createdItems: number;
  catalogUpdates: number;
  skipped: number;
  /** Lines repriced in other selected jobs (matched by material). */
  propagatedLines: number;
  /** Distinct other jobs touched. */
  propagatedJobs: number;
  stateCounts: PriceStateCounts;
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

/** Earthwork grade intent for an area. null = ordinary surface-restoration area. */
export type GradeMode = 'cut_depth' | 'fill_depth' | 'finished_elev';
/** An elevation surface attached to a job. */
export type SurfaceKind = 'existing' | 'proposed';

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
  /** When set, this area is an earthwork region rather than surface restoration. */
  gradeMode?: GradeMode | null;
  /** Depth (cut/fill modes) or finished elevation (finished_elev), in feet. */
  gradeValueFt?: number | null;
  points: { x: number; y: number }[];
}

export interface SaveTakeoffAreaPayload extends Omit<TakeoffAreaDTO, 'id'> {
  id?: number;
  sortOrder?: number;
}

/**
 * A measured wall run: an open polyline traced on the plan, given a height,
 * thickness, and finished/formed-face count so it expands to surface area,
 * volume, and (optionally) vertical members. Trade-agnostic — the linked
 * material/assembly defines what is billed (concrete, framing, masonry, ...).
 */
export interface TakeoffWallDTO {
  id: number;
  jobId: number;
  label: string;
  /** Wall height, feet (the dimension the plan view can't supply). */
  heightFt: number;
  /** Wall thickness, inches. */
  thicknessIn: number;
  /** Number of finished/formed faces (1 = one side, 2 = both). */
  faces: number;
  /** Vertical-member spacing o.c. — studs / bars / posts, inches (0 = none). */
  memberSpacingIn: number;
  materialId: number | null;
  /** When set, Send to Bid expands this assembly per measured unit. */
  assemblyId: number | null;
  color: string;
  pdfPage: number;
  points: { x: number; y: number }[];
}
export interface SaveTakeoffWallPayload extends Omit<TakeoffWallDTO, 'id'> {
  id?: number;
  sortOrder?: number;
}

export interface TakeoffSurfacePointDTO {
  x: number;       // PDF-native px (at scale=1)
  y: number;
  z: number;       // elevation, feet
  pdfPage: number;
}

export interface TakeoffSurfaceDTO {
  id: number;
  jobId: number;
  kind: SurfaceKind;
  name: string;
  points: TakeoffSurfacePointDTO[];
}

export interface SaveTakeoffSurfacePayload extends Omit<TakeoffSurfaceDTO, 'id'> {
  id?: number;
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
  walls: TakeoffWallDTO[];
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
