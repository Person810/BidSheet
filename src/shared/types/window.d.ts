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
      getBidSections: (jobId: number) => Promise<any[]>;
      saveBidSection: (section: any) => Promise<any>;
      deleteBidSection: (id: number) => Promise<any>;
      getBidLineItems: (sectionId: number) => Promise<any[]>;
      saveBidLineItem: (item: any) => Promise<any>;
      deleteBidLineItem: (id: number) => Promise<any>;
      getBidSummary: (jobId: number) => Promise<any>;

      // Settings
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;

      // Setup
      isSetupComplete: () => Promise<boolean>;
      runSetup: (trades: string[], includeBallparkPrices: boolean, companyName: string) => Promise<any>;

      // Import/Export
      exportDatabase: () => Promise<any>;
      importPriceSheet: (filePath: string) => Promise<any>;
    };
  }
}
