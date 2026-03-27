// ============================================================
// MATERIAL TYPES
// ============================================================

export interface MaterialCategory {
  id: number;
  name: string;           // e.g. "PVC Pipe", "Fittings", "Manholes", "Valves"
  description?: string;
}

export interface Material {
  id: number;
  categoryId: number;
  name: string;           // e.g. "8\" PVC SDR-35"
  description?: string;
  unit: string;           // "LF", "EA", "CY", "TON", etc.
  defaultUnitCost: number;  // last known / default price
  supplier?: string;
  partNumber?: string;
  lastPriceUpdate: string;  // ISO date of last price update
  notes?: string;
  isActive: boolean;
}

// ============================================================
// LABOR TYPES
// ============================================================

export interface LaborRole {
  id: number;
  name: string;           // "Operator", "Pipe Layer", "Laborer", "Foreman"
  defaultHourlyRate: number;
  burdenMultiplier: number; // e.g. 1.35 for benefits/taxes/insurance
  notes?: string;
}

export interface CrewTemplate {
  id: number;
  name: string;           // e.g. "4-Man Pipe Crew", "2-Man Service Crew"
  description?: string;
  members: CrewMember[];
}

export interface CrewMember {
  id: number;
  crewTemplateId: number;
  laborRoleId: number;
  quantity: number;        // e.g. 2 laborers
}

export interface ProductionRate {
  id: number;
  description: string;    // e.g. "8\" PVC SDR-35 @ 4-6' depth"
  crewTemplateId: number;
  unit: string;            // "LF", "EA", "VF" (vertical feet)
  ratePerHour: number;     // units installed per hour
  conditions?: string;     // "Normal soil", "Rock", "High water table"
  notes?: string;
}

// ============================================================
// EQUIPMENT TYPES
// ============================================================

export interface Equipment {
  id: number;
  name: string;           // "CAT 320 Excavator", "Case 580 Backhoe"
  category: string;       // "Excavator", "Loader", "Compactor", "Truck", "Pump"
  hourlyRate: number;     // operating cost per hour (ownership or rental)
  dailyRate?: number;     // if rental
  mobilizationCost: number; // cost to get it to the job
  fuelCostPerHour?: number;
  notes?: string;
  isOwned: boolean;       // owned vs rented affects cost calc
  isActive: boolean;
}

// ============================================================
// BID / JOB TYPES
// ============================================================

export interface Job {
  id: number;
  name: string;            // "Elm Street Sewer Extension"
  jobNumber?: string;      // internal tracking number
  client: string;          // GC or owner name
  location?: string;
  bidDate?: string;        // ISO date - when bid is due
  startDate?: string;
  description?: string;
  status: JobStatus;
  overheadPercent: number; // overhead markup %
  profitPercent: number;   // profit markup %
  bondPercent?: number;    // bid bond / performance bond %
  taxPercent?: number;     // sales tax on materials
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'draft' | 'submitted' | 'won' | 'lost' | 'archived';

export interface BidSection {
  id: number;
  jobId: number;
  name: string;            // "Sanitary Sewer", "Storm Drain", "Water Main"
  sortOrder: number;
}

export interface BidLineItem {
  id: number;
  sectionId: number;
  jobId: number;
  description: string;     // "8\" PVC SDR-35 Sanitary Sewer @ 6' avg depth"
  quantity: number;
  unit: string;            // "LF", "EA", "LS"
  sortOrder: number;

  // Material cost
  materialId?: number;     // link to material catalog (optional)
  materialUnitCost: number; // price used for THIS bid (may differ from catalog)
  materialTotal: number;   // quantity * materialUnitCost

  // Labor cost
  crewTemplateId?: number;
  productionRateId?: number;
  laborHours: number;      // calculated from quantity / productionRate
  laborCostPerHour: number; // fully burdened crew cost per hour
  laborTotal: number;

  // Equipment cost
  equipmentCostPerHour: number;
  equipmentHours: number;
  equipmentTotal: number;

  // Subcontractor cost (for items you sub out)
  subcontractorCost: number;

  // Rollup
  unitCost: number;        // total cost / quantity
  totalCost: number;       // material + labor + equipment + sub
  notes?: string;
}

// ============================================================
// ASSEMBLIES (reusable material bundles)
// ============================================================

export interface Assembly {
  id: number;
  name: string;           // e.g. "8\" Water Main per LF"
  description?: string;
  unit: string;           // "LF", "EA", "LS" — the unit the assembly is measured in
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: AssemblyItem[];  // materials bundled in this assembly
}

export interface AssemblyItem {
  id: number;
  assemblyId: number;
  materialId: number;
  quantity: number;       // qty of this material per 1 unit of assembly
  notes?: string;
  // Joined fields (not stored, populated on read)
  materialName?: string;
  materialUnit?: string;
  materialUnitCost?: number;
}

// ============================================================
// BID SUMMARY (calculated, not stored)
// ============================================================

export interface BidSummary {
  jobId: number;
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  subcontractorTotal: number;
  directCostTotal: number;
  overhead: number;
  profit: number;
  bond: number;
  tax: number;
  grandTotal: number;
}

// ============================================================
// SUPPLIER PRICE IMPORT
// ============================================================

export interface PriceUpdate {
  id: number;
  materialId: number;
  oldPrice: number;
  newPrice: number;
  source: string;          // "Manual", "Supplier: Ferguson", etc.
  updatedAt: string;
}

// ============================================================
// APP SETTINGS
// ============================================================

export interface AppSettings {
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyLogo?: string;    // path to logo file
  defaultOverheadPercent: number;
  defaultProfitPercent: number;
  defaultTaxPercent: number;
  defaultBondPercent: number;
}
