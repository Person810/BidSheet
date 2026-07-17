import type {
  AddDocumentsResult,
  AppSettingsRow,
  AssemblyRow,
  BackupReminderStatus,
  BidItemImportRow,
  BidLineItemRow,
  BidSectionRow,
  CsvParseResult,
  EquipmentRow,
  FileExportResult,
  IndirectCostRow,
  JobBidSummary,
  JobDocumentRow,
  JobRow,
  SaveIndirectCostPayload,
  MaterialCategoryRow,
  MaterialRow,
  MaterialWithCategoryRow,
  PageScaleListEntry,
  PageScaleRow,
  PriceImportCommitPayload,
  PriceImportCommitResult,
  PriceImportContext,
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
  SaveTakeoffWallPayload,
  TakeoffWallDTO,
  SaveTakeoffRunPayload,
  SaveTakeoffSettingsPayload,
  SaveTakeoffSurfacePayload,
  TakeoffSurfaceDTO,
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
import type { PdfTemplate } from './pdf';

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
      importBidItems: (jobId: number, sectionId: number, items: BidItemImportRow[]) => Promise<{ imported: number }>;
      replaceBidState: (
        jobId: number,
        state: { sections: BidSectionRow[]; lineItems: Record<number, BidLineItemRow[]> },
      ) => Promise<{ success: boolean }>;
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
      chooseLogoFile: () => Promise<{ dataUrl: string } | null>;

      // Setup
      isSetupComplete: () => Promise<boolean>;
      runSetup: (trades: string[], includeBallparkPrices: boolean, companyName: string, localOnlyMode?: boolean) => Promise<{ success: boolean }>;

      // CSV Import
      openCsvFile: () => Promise<CsvParseResult | null>;
      parseCsvPath: (filePath: string) => Promise<CsvParseResult>;
      /** Resolve a drag-and-dropped File to its on-disk path (Electron webUtils). */
      getDroppedFilePath: (file: File) => string;
      importPriceSheet: (updates: PriceImportUpdate[], source: string) => Promise<PriceImportResult>;
      priceImportContext: (jobId: number) => Promise<PriceImportContext>;
      priceImportCommit: (jobId: number, payload: PriceImportCommitPayload) => Promise<PriceImportCommitResult>;

      // Quotes
      getQuotes: (jobId: number) => Promise<QuoteRow[]>;
      saveQuote: (quote: SaveQuotePayload) => Promise<{ id: number }>;
      selectQuote: (jobId: number, scope: string, quoteId: number | null) => Promise<{ success: boolean }>;
      deleteQuote: (id: number) => Promise<SqlRunResult>;
      getQuoteVendors: () => Promise<{ vendor: string; contact: string | null; quote_count: number }[]>;

      // Indirect costs
      getIndirectCosts: (jobId: number) => Promise<IndirectCostRow[]>;
      saveIndirectCost: (indirect: SaveIndirectCostPayload) => Promise<{ id: number }>;
      deleteIndirectCost: (id: number) => Promise<SqlRunResult>;

      // Job documents
      listJobDocuments: (jobId: number) => Promise<JobDocumentRow[]>;
      /** Opens a native multi-select dialog; null when the user cancels */
      addJobDocuments: (jobId: number, category: string) => Promise<AddDocumentsResult | null>;
      addJobDocumentPaths: (jobId: number, paths: string[], category: string) => Promise<AddDocumentsResult>;
      openJobDocument: (id: number) => Promise<void>;
      revealJobDocument: (id: number) => Promise<void>;
      updateJobDocument: (id: number, fields: { category?: string; notes?: string | null }) => Promise<void>;
      deleteJobDocument: (id: number) => Promise<void>;

      // Export
      exportQuickBooksCSV: (jobId: number) => Promise<FileExportResult>;
      exportUnitPriceCSV: (jobId: number) => Promise<FileExportResult>;
      saveCsv: (defaultName: string, title: string, csvContent: string) => Promise<FileExportResult>;
      exportBidPdf: (jobId: number) => Promise<{ success: boolean; filePath?: string; canceled?: boolean }>;
      printBid: (jobId: number) => Promise<{ success: boolean; canceled?: boolean; openedPdf?: boolean; filePath?: string }>;
      getPdfHtml: (jobId: number, template: PdfTemplate) => Promise<string>;
      getPdfTemplate: () => Promise<PdfTemplate>;
      savePdfTemplate: (template: PdfTemplate) => Promise<void>;
      exportBidPdfWithTemplate: (jobId: number, template: PdfTemplate) => Promise<{ success: boolean; filePath?: string; canceled?: boolean }>;

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
      listTakeoffWalls: (jobId: number) => Promise<TakeoffWallDTO[]>;
      saveTakeoffWall: (wall: SaveTakeoffWallPayload) => Promise<{ id: number }>;
      deleteTakeoffWall: (id: number) => Promise<SqlRunResult>;
      listTakeoffSurfaces: (jobId: number) => Promise<TakeoffSurfaceDTO[]>;
      saveTakeoffSurface: (s: SaveTakeoffSurfacePayload) => Promise<{ id: number }>;
      deleteTakeoffSurface: (id: number) => Promise<SqlRunResult>;
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

      // Cloud Sync
      cloudStatus: () => Promise<{ auth: any; sync: any }>;
      cloudSignUp: (email: string, password: string) => Promise<any>;
      cloudSignIn: (email: string, password: string) => Promise<any>;
      cloudEnrollTotp: () => Promise<{ factorId: string; qrCode: string; secret: string; uri: string }>;
      cloudVerifyTotp: (code: string, factorId?: string) => Promise<any>;
      cloudSignOut: () => Promise<void>;
      cloudMe: () => Promise<{ user_id: string; email: string; account: any; role?: string; billing_enabled?: boolean }>;
      cloudBillingCheckout: () => Promise<string>;
      cloudBillingPortal: () => Promise<string>;
      cloudSyncNow: () => Promise<any>;
      cloudEnableJob: (jobId: number) => Promise<void>;
      cloudDisableJob: (jobId: number) => Promise<void>;
      cloudPushJob: (jobId: number) => Promise<void>;
      cloudPullJob: (cloudId: string) => Promise<number>;
      cloudResolveConflict: (jobId: number, keep: 'local' | 'cloud') => Promise<void>;
      cloudRestoreAll: () => Promise<
        { cloudId: string; name: string; ok: boolean; error: string | null }[]
      >;
      cloudE2eeState: () => Promise<
        'not_setup' | 'unlocked' | 'locked' | 'pending_approval' | 'unavailable'
      >;
      cloudE2eeSetup: (shorter?: boolean) => Promise<{ recoveryKey: string }>;
      cloudE2eeUnlock: (recoveryKey: string) => Promise<void>;
      cloudE2eeRegenerateRecovery: (shorter?: boolean) => Promise<{ recoveryKey: string }>;
      cloudOrgMembers: () => Promise<{
        members: {
          user_id: string;
          role: string;
          email: string | null;
          created_at: string;
          key_status: 'pending' | 'active' | null;
          pubkey: string | null;
          has_wrap: number;
        }[];
        me: { user_id: string; role: string };
      }>;
      cloudOrgCreateInvite: (
        role?: 'member' | 'owner'
      ) => Promise<{ id: string; token: string; role: string }>;
      cloudOrgListInvites: () => Promise<
        { id: string; role: string; expires_at: string; opened_count: number; created_at: string }[]
      >;
      cloudOrgRevokeInvite: (id: string) => Promise<void>;
      cloudOrgRedeemInvite: (token: string, shorter?: boolean) => Promise<{ recoveryKey: string }>;
      cloudOrgApproveMember: (userId: string) => Promise<void>;
      cloudOrgRemoveMember: (userId: string) => Promise<void>;
      cloudBackupStatus: () => Promise<{
        configured: boolean;
        lastBackupAt: string | null;
        remote: {
          size_bytes: number;
          app_version: string | null;
          schema_version: number | null;
          created_at: string;
        } | null;
      }>;
      cloudBackupNow: () => Promise<{ uploaded: boolean }>;
      cloudBackupDisable: () => Promise<void>;
      cloudBackupRestore: (recoveryKey: string) => Promise<void>;
      onCloudSyncStatus: (callback: (data: any) => void) => () => void;
      onCloudCatalogUpdated: (callback: (data: { applied: number }) => void) => () => void;
    };
  }
}
