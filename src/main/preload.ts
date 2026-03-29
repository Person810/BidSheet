import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // ---- Materials ----
  getMaterialCategories: () => ipcRenderer.invoke('db:material-categories:list'),
  getMaterials: (categoryId?: number) => ipcRenderer.invoke('db:materials:list', categoryId),
  getMaterial: (id: number) => ipcRenderer.invoke('db:materials:get', id),
  saveMaterial: (material: any) => ipcRenderer.invoke('db:materials:save', material),
  deleteMaterial: (id: number) => ipcRenderer.invoke('db:materials:delete', id),
  updateMaterialPrice: (id: number, newPrice: number, source: string) =>
    ipcRenderer.invoke('db:materials:update-price', id, newPrice, source),
  getMaterialsByCategoryName: (name: string) => ipcRenderer.invoke('db:materials:list-by-category-name', name),

  // ---- Labor ----
  getLaborRoles: () => ipcRenderer.invoke('db:labor-roles:list'),
  saveLaborRole: (role: any) => ipcRenderer.invoke('db:labor-roles:save', role),
  getCrewTemplates: () => ipcRenderer.invoke('db:crew-templates:list'),
  getCrewTemplate: (id: number) => ipcRenderer.invoke('db:crew-templates:get', id),
  saveCrewTemplate: (template: any) => ipcRenderer.invoke('db:crew-templates:save', template),
  getProductionRates: () => ipcRenderer.invoke('db:production-rates:list'),
  saveProductionRate: (rate: any) => ipcRenderer.invoke('db:production-rates:save', rate),

  // ---- Equipment ----
  getEquipment: () => ipcRenderer.invoke('db:equipment:list'),
  saveEquipment: (equip: any) => ipcRenderer.invoke('db:equipment:save', equip),
  deleteEquipment: (id: number) => ipcRenderer.invoke('db:equipment:delete', id),

  // ---- Jobs / Bids ----
  getJobs: (status?: string) => ipcRenderer.invoke('db:jobs:list', status),
  getJob: (id: number) => ipcRenderer.invoke('db:jobs:get', id),
  saveJob: (job: any) => ipcRenderer.invoke('db:jobs:save', job),
  deleteJob: (id: number) => ipcRenderer.invoke('db:jobs:delete', id),
  duplicateJob: (id: number) => ipcRenderer.invoke('db:jobs:duplicate', id),
  getChangeOrders: (parentJobId: number) => ipcRenderer.invoke('db:jobs:change-orders', parentJobId),
  createChangeOrder: (parentJobId: number) => ipcRenderer.invoke('db:jobs:create-change-order', parentJobId),

  getBidSections: (jobId: number) => ipcRenderer.invoke('db:bid-sections:list', jobId),
  saveBidSection: (section: any) => ipcRenderer.invoke('db:bid-sections:save', section),
  deleteBidSection: (id: number) => ipcRenderer.invoke('db:bid-sections:delete', id),

  getBidLineItems: (sectionId: number) => ipcRenderer.invoke('db:line-items:list', sectionId),
  saveBidLineItem: (item: any) => ipcRenderer.invoke('db:line-items:save', item),
  deleteBidLineItem: (id: number) => ipcRenderer.invoke('db:line-items:delete', id),

  getBidSummary: (jobId: number) => ipcRenderer.invoke('db:jobs:summary', jobId),

  // ---- Trench Profiles ----
  getTrenchProfiles: (jobId: number) => ipcRenderer.invoke('db:trench-profiles:list', jobId),
  saveTrenchProfile: (profile: any) => ipcRenderer.invoke('db:trench-profiles:save', profile),
  deleteTrenchProfile: (id: number) => ipcRenderer.invoke('db:trench-profiles:delete', id),
  reorderTrenchProfiles: (items: any[]) => ipcRenderer.invoke('db:trench-profiles:reorder', items),

  // ---- Assemblies ----
  getAssemblies: () => ipcRenderer.invoke('db:assemblies:list'),
  getAssembly: (id: number) => ipcRenderer.invoke('db:assemblies:get', id),
  saveAssembly: (assembly: any) => ipcRenderer.invoke('db:assemblies:save', assembly),
  deleteAssembly: (id: number) => ipcRenderer.invoke('db:assemblies:delete', id),

  // ---- Settings ----
  getSettings: () => ipcRenderer.invoke('db:settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('db:settings:save', settings),

  // ---- Setup ----
  isSetupComplete: () => ipcRenderer.invoke('db:setup:is-complete'),
  runSetup: (trades: string[], includeBallparkPrices: boolean, companyName: string) =>
    ipcRenderer.invoke('db:setup:run', trades, includeBallparkPrices, companyName),

  // ---- CSV Import ----
  openCsvFile: () => ipcRenderer.invoke('db:csv:open'),
  parseCsvPath: (filePath: string) => ipcRenderer.invoke('db:csv:parse-path', filePath),
  importPriceSheet: (updates: any[], source: string) =>
    ipcRenderer.invoke('db:materials:import-prices', updates, source),

  // ---- Backup/Restore ----
  exportDatabase: () => ipcRenderer.invoke('db:export'),
  restoreDatabase: () => ipcRenderer.invoke('db:restore'),
  checkBackupReminder: () => ipcRenderer.invoke('db:settings:backup-reminder-needed'),
  dismissBackupReminder: () => ipcRenderer.invoke('db:settings:dismiss-backup-reminder'),

  // ---- App Info ----
  getLogDir: () => ipcRenderer.invoke('app:log-dir'),

});
