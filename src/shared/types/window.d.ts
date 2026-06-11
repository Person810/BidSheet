import type {
  AppSettingsRow,
  AssemblyRow,
  BackupReminderStatus,
  BidLineItemRow,
  BidSectionRow,
  CsvParseResult,
  EquipmentRow,
  FileExportResult,
  JobBidSummary,
  JobRow,
  MaterialCategoryRow,
  MaterialRow,
  MaterialWithCategoryRow,
  PageScaleListEntry,
  PageScaleRow,
  PriceImportResult,
  PriceImportUpdate,
  ProductionRateRow,
  QuoteRow,
  SaveAssemblyPayload,
  SaveBidLineItemPayload,
  SaveBidSectionPayload,
  SaveCrewTemplatePayload,
  SaveEquipmentPayload,
  SaveJobPayload,
  SaveLaborRolePayload,
  SaveMaterialPayload,
  SavePageScalePayload,
  SaveProductionRatePayload,
  SaveQuotePayload,
  SaveSettingsPayload,
  SaveTakeoffAreaPayload,
  SaveTakeoffRunPayload,
  SaveTakeoffSettingsPayload,
  SaveTrenchProfilePayload,
  SqlRunResult,
  TakeoffAnnotationDTO,
  TakeoffAreaDTO,
  TakeoffItemDTO,
  TakeoffJobSettingsRow,
  TakeoffNodeDTO,
  TakeoffRunDTO,
  TakeoffStateSnapshot,
  TrenchProfileRow,
  UpdateStatusEvent,
} from './ipc';
import type { CrewTemplate, LaborRole } from './labor';

export {};

declare global {
  interface Window {
    api: {
      // Materials
      getMaterialCategories: () => Promise<MaterialCategoryRow[]>;
      getMaterials: (categoryId?: number, includeInactive?: boolean) => Promise<MaterialRow[]>;
      getMaterial: (id: number) => Promise<MaterialRow | undefined>;
      saveMaterial: (material: SaveMaterialPayload) => Promise<SqlRunResult>;
      deleteMaterial: (id: number) => Promise<SqlRunResult>;
      restoreMaterial: (id: number) => Promise<SqlRunResult>;
      updateMaterialPrice: (id: number, newPrice: number, source: string) => Promise<{ success: boolean } | null>;
      getMaterialsByCategoryName: (name: string) => Promise<MaterialWithCategoryRow[]>;

      // Labor
      getLaborRoles: () => Promise<LaborRole[]>;
      saveLaborRole: (role: SaveLaborRolePayload) => Promise<SqlRunResult>;
      deleteLaborRole: (id: number) => Promise<SqlRunResult>;
      getCrewTemplates: () => Promise<CrewTemplate[]>;
      getCrewTemplate: (id: number) => Promise<CrewTemplate | null>;
      saveCrewTemplate: (template: SaveCrewTemplatePayload) => Promise<number>;
      deleteCrewTemplate: (id: number) => Promise<SqlRunResult>;
      getProductionRates: () => Promise<ProductionRateRow[]>;
      saveProductionRate: (rate: SaveProductionRatePayload) => Promise<SqlRunResult>;
      deleteProductionRate: (id: number) => Promise<SqlRunResult>;

      // Equipment
      getEquipment: (includeInactive?: boolean) => Promise<EquipmentRow[]>;
      saveEquipment: (equip: SaveEquipmentPayload) => Promise<SqlRunResult>;
      deleteEquipment: (id: number) => Promise<SqlRunResult>;
      restoreEquipment: (id: number) => Promise<SqlRunResult>;

      // Jobs / Bids
      getJobs: (status?: string) => Promise<JobRow[]>;
      getJob: (id: number) => Promise<JobRow | undefined>;
      saveJob: (job: SaveJobPayload) => Promise<SqlRunResult>;
      deleteJob: (id: number) => Promise<SqlRunResult>;
      duplicateJob: (id: number, newName?: string, newBidDate?: string | null) => Promise<{ newJobId: number } | null>;
      getChangeOrders: (parentJobId: number) => Promise<JobRow[]>;
      createChangeOrder: (parentJobId: number) => Promise<{ newJobId: number; changeOrderNumber: number } | null>;
      getBidSections: (jobId: number) => Promise<BidSectionRow[]>;
      saveBidSection: (section: SaveBidSectionPayload) => Promise<{ id: number }>;
      deleteBidSection: (id: number) => Promise<SqlRunResult>;
      getBidLineItems: (sectionId: number) => Promise<BidLineItemRow[]>;
      saveBidLineItem: (item: SaveBidLineItemPayload) => Promise<SqlRunResult>;
      deleteBidLineItem: (id: number) => Promise<SqlRunResult>;
      getBidSummary: (jobId: number) => Promise<JobBidSummary | null>;
      getBidSummaryBatch: (jobIds: number[]) => Promise<JobBidSummary[]>;

      // Trench Profiles
      getTrenchProfiles: (jobId: number) => Promise<TrenchProfileRow[]>;
      saveTrenchProfile: (profile: SaveTrenchProfilePayload) => Promise<{ id: number }>;
      deleteTrenchProfile: (id: number) => Promise<SqlRunResult>;
      reorderTrenchProfiles: (items: { id: number; sortOrder: number }[]) => Promise<void>;

      // Assemblies
      getAssemblies: () => Promise<AssemblyRow[]>;
      getAssembly: (id: number) => Promise<AssemblyRow | null>;
      saveAssembly: (assembly: SaveAssemblyPayload) => Promise<number>;
      deleteAssembly: (id: number) => Promise<SqlRunResult>;

      // Settings
      getSettings: () => Promise<AppSettingsRow>;
      saveSettings: (settings: SaveSettingsPayload) => Promise<SqlRunResult>;

      // Setup
      isSetupComplete: () => Promise<boolean>;
      runSetup: (trades: string[], includeBallparkPrices: boolean, companyName: string) => Promise<{ success: boolean }>;

      // CSV Import
      openCsvFile: () => Promise<CsvParseResult | null>;
      parseCsvPath: (filePath: string) => Promise<CsvParseResult>;
      importPriceSheet: (updates: PriceImportUpdate[], source: string) => Promise<PriceImportResult>;

      // Quotes
      getQuotes: (jobId: number) => Promise<QuoteRow[]>;
      saveQuote: (quote: SaveQuotePayload) => Promise<{ id: number }>;
      selectQuote: (jobId: number, scope: string, quoteId: number | null) => Promise<{ success: boolean }>;
      deleteQuote: (id: number) => Promise<SqlRunResult>;

      // Export
      exportQuickBooksCSV: (jobId: number) => Promise<FileExportResult>;
      exportUnitPriceCSV: (jobId: number) => Promise<FileExportResult>;
      saveCsv: (defaultName: string, title: string, csvContent: string) => Promise<FileExportResult>;
      exportBidPdf: (jobId: number) => Promise<{ success: boolean; filePath?: string; canceled?: boolean }>;
      printBid: (jobId: number) => Promise<{ success: boolean }>;

      // Backup/Restore
      exportDatabase: () => Promise<FileExportResult>;
      restoreDatabase: () => Promise<FileExportResult>;
      checkBackupReminder: () => Promise<BackupReminderStatus>;
      dismissBackupReminder: () => Promise<{ success: boolean }>;

      // Plan Takeoff
      openTakeoffPdf: () => Promise<{ filePath: string; data: ArrayBuffer } | null>;
      readTakeoffPdf: (filePath: string) => Promise<{ data: ArrayBuffer } | null>;
      getTakeoffSettings: (jobId: number) => Promise<TakeoffJobSettingsRow | null>;
      saveTakeoffSettings: (settings: SaveTakeoffSettingsPayload) => Promise<SqlRunResult>;
      getPageScale: (jobId: number, pageNumber: number) => Promise<PageScaleRow | null>;
      savePageScale: (data: SavePageScalePayload) => Promise<SqlRunResult>;
      listPageScales: (jobId: number) => Promise<PageScaleListEntry[]>;
      listTakeoffRuns: (jobId: number) => Promise<TakeoffRunDTO[]>;
      saveTakeoffRun: (run: SaveTakeoffRunPayload) => Promise<{ id: number }>;
      deleteTakeoffRun: (id: number) => Promise<SqlRunResult>;
      updateTakeoffPoint: (data: { runId: number; sortOrder: number; invertElev: number | null; rimElev: number | null; structureType: string | null; nodeId?: number | null }) => Promise<SqlRunResult>;
      listTakeoffItems: (jobId: number) => Promise<TakeoffItemDTO[]>;
      saveTakeoffItem: (item: Omit<TakeoffItemDTO, 'id' | 'materialName'> & { id?: number; materialName?: string }) => Promise<{ id: number }>;
      deleteTakeoffItem: (id: number) => Promise<SqlRunResult>;
      listTakeoffAreas: (jobId: number) => Promise<TakeoffAreaDTO[]>;
      saveTakeoffArea: (area: SaveTakeoffAreaPayload) => Promise<{ id: number }>;
      deleteTakeoffArea: (id: number) => Promise<SqlRunResult>;
      exportTakeoffCsv: (jobId: number, csvContent: string) => Promise<FileExportResult>;
      replaceTakeoffState: (jobId: number, state: TakeoffStateSnapshot) => Promise<{ success: boolean }>;
      listTakeoffAnnotations: (jobId: number) => Promise<TakeoffAnnotationDTO[]>;
      saveTakeoffAnnotation: (ann: Omit<TakeoffAnnotationDTO, 'id'> & { id?: number }) => Promise<{ id: number }>;
      deleteTakeoffAnnotation: (id: number) => Promise<SqlRunResult>;
      getPageRotation: (jobId: number, pageNumber: number) => Promise<number>;
      savePageRotation: (jobId: number, pageNumber: number, rotation: number) => Promise<SqlRunResult>;
      listTakeoffNodes: (jobId: number) => Promise<TakeoffNodeDTO[]>;
      saveTakeoffNode: (node: Omit<TakeoffNodeDTO, 'id'> & { id?: number }) => Promise<{ id: number }>;
      deleteTakeoffNode: (id: number) => Promise<SqlRunResult>;
      getNodeConnectedRuns: (nodeId: number) => Promise<number[]>;

      // App Info
      getLogDir: () => Promise<string>;

      // Updates
      checkForUpdate: () => Promise<{ version: string } | null>;
      downloadUpdate: () => Promise<boolean>;
      installUpdate: () => Promise<void>;
      getAppVersion: () => Promise<string>;
      onUpdateStatus: (callback: (data: UpdateStatusEvent) => void) => () => void;
    };
  }
}
