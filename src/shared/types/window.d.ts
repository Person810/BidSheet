export {};

declare global {
  interface Window {
    api: {
      // Materials
      getMaterialCategories: () => Promise<any[]>;
      getMaterials: (categoryId?: number) => Promise<any[]>;
      getMaterial: (id: number) => Promise<any>;
      saveMaterial: (material: any) => Promise<any>;
      deleteMaterial: (id: number) => Promise<any>;
      updateMaterialPrice: (id: number, newPrice: number, source: string) => Promise<any>;
      getMaterialsByCategoryName: (name: string) => Promise<any[]>;

      // Labor
      getLaborRoles: () => Promise<any[]>;
      saveLaborRole: (role: any) => Promise<any>;
      getCrewTemplates: () => Promise<any[]>;
      getCrewTemplate: (id: number) => Promise<any>;
      saveCrewTemplate: (template: any) => Promise<any>;
      getProductionRates: () => Promise<any[]>;
      saveProductionRate: (rate: any) => Promise<any>;

      // Equipment
      getEquipment: () => Promise<any[]>;
      saveEquipment: (equip: any) => Promise<any>;
      deleteEquipment: (id: number) => Promise<any>;

      // Jobs / Bids
      getJobs: (status?: string) => Promise<any[]>;
      getJob: (id: number) => Promise<any>;
      saveJob: (job: any) => Promise<any>;
      deleteJob: (id: number) => Promise<any>;
      duplicateJob: (id: number) => Promise<any>;
      getChangeOrders: (parentJobId: number) => Promise<any[]>;
      createChangeOrder: (parentJobId: number) => Promise<any>;
      getBidSections: (jobId: number) => Promise<any[]>;
      saveBidSection: (section: any) => Promise<any>;
      deleteBidSection: (id: number) => Promise<any>;
      getBidLineItems: (sectionId: number) => Promise<any[]>;
      saveBidLineItem: (item: any) => Promise<any>;
      deleteBidLineItem: (id: number) => Promise<any>;
      getBidSummary: (jobId: number) => Promise<any>;

      // Trench Profiles
      getTrenchProfiles: (jobId: number) => Promise<any[]>;
      saveTrenchProfile: (profile: any) => Promise<any>;
      deleteTrenchProfile: (id: number) => Promise<any>;
      reorderTrenchProfiles: (items: any[]) => Promise<any>;

      // Assemblies
      getAssemblies: () => Promise<any[]>;
      getAssembly: (id: number) => Promise<any>;
      saveAssembly: (assembly: any) => Promise<any>;
      deleteAssembly: (id: number) => Promise<any>;

      // Settings
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;

      // Setup
      isSetupComplete: () => Promise<boolean>;
      runSetup: (trades: string[], includeBallparkPrices: boolean, companyName: string) => Promise<any>;

      // CSV Import
      openCsvFile: () => Promise<any>;
      parseCsvPath: (filePath: string) => Promise<any>;
      importPriceSheet: (updates: any[], source: string) => Promise<any>;

      // Backup/Restore
      exportDatabase: () => Promise<any>;
      restoreDatabase: () => Promise<any>;
      checkBackupReminder: () => Promise<{ needed: boolean; currentVersion: number; lastBackupVersion: number }>;
      dismissBackupReminder: () => Promise<any>;

      // Plan Takeoff
      openTakeoffPdf: () => Promise<{ filePath: string; data: ArrayBuffer } | null>;
      getTakeoffSettings: (jobId: number) => Promise<any>;
      saveTakeoffSettings: (settings: any) => Promise<any>;
      listTakeoffRuns: (jobId: number) => Promise<any[]>;
      saveTakeoffRun: (run: any) => Promise<any>;
      deleteTakeoffRun: (id: number) => Promise<any>;
      listTakeoffItems: (jobId: number) => Promise<any[]>;
      saveTakeoffItem: (item: any) => Promise<any>;
      deleteTakeoffItem: (id: number) => Promise<any>;

      // App Info
      getLogDir: () => Promise<string>;

    };
  }
}
