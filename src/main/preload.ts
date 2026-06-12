import { contextBridge, ipcRenderer } from 'electron';

// Electron prefixes errors crossing IPC with
// "Error invoking remote method 'channel': Error: ..." -- strip that
// plumbing so the renderer's toasts show only the friendly message
// produced by safeHandle in ipc-handlers.ts.
function invoke(channel: string, ...args: any[]): Promise<any> {
  return ipcRenderer.invoke(channel, ...args).catch((err: any) => {
    const msg = String(err?.message || err).replace(
      /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/,
      ''
    );
    throw new Error(msg);
  });
}

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // ---- Materials ----
  getMaterialCategories: () => invoke('db:material-categories:list'),
  getMaterials: (categoryId?: number, includeInactive?: boolean) => invoke('db:materials:list', categoryId, includeInactive),
  getMaterial: (id: number) => invoke('db:materials:get', id),
  saveMaterial: (material: any) => invoke('db:materials:save', material),
  deleteMaterial: (id: number) => invoke('db:materials:delete', id),
  restoreMaterial: (id: number) => invoke('db:materials:restore', id),
  updateMaterialPrice: (id: number, newPrice: number, source: string) =>
    invoke('db:materials:update-price', id, newPrice, source),
  getMaterialsByCategoryName: (name: string) => invoke('db:materials:list-by-category-name', name),

  // ---- Labor ----
  getLaborRoles: () => invoke('db:labor-roles:list'),
  saveLaborRole: (role: any) => invoke('db:labor-roles:save', role),
  deleteLaborRole: (id: number) => invoke('db:labor-roles:delete', id),
  getCrewTemplates: () => invoke('db:crew-templates:list'),
  getCrewTemplate: (id: number) => invoke('db:crew-templates:get', id),
  saveCrewTemplate: (template: any) => invoke('db:crew-templates:save', template),
  deleteCrewTemplate: (id: number) => invoke('db:crew-templates:delete', id),
  getProductionRates: () => invoke('db:production-rates:list'),
  saveProductionRate: (rate: any) => invoke('db:production-rates:save', rate),
  deleteProductionRate: (id: number) => invoke('db:production-rates:delete', id),

  // ---- Equipment ----
  getEquipment: (includeInactive?: boolean) => invoke('db:equipment:list', includeInactive),
  saveEquipment: (equip: any) => invoke('db:equipment:save', equip),
  deleteEquipment: (id: number) => invoke('db:equipment:delete', id),
  restoreEquipment: (id: number) => invoke('db:equipment:restore', id),

  // ---- Jobs / Bids ----
  getJobs: (status?: string) => invoke('db:jobs:list', status),
  getJob: (id: number) => invoke('db:jobs:get', id),
  saveJob: (job: any) => invoke('db:jobs:save', job),
  deleteJob: (id: number) => invoke('db:jobs:delete', id),
  duplicateJob: (id: number, newName?: string, newBidDate?: string) => invoke('db:jobs:duplicate', id, newName, newBidDate),
  getChangeOrders: (parentJobId: number) => invoke('db:jobs:change-orders', parentJobId),
  createChangeOrder: (parentJobId: number) => invoke('db:jobs:create-change-order', parentJobId),

  getBidSections: (jobId: number) => invoke('db:bid-sections:list', jobId),
  saveBidSection: (section: any) => invoke('db:bid-sections:save', section),
  deleteBidSection: (id: number) => invoke('db:bid-sections:delete', id),

  getBidLineItems: (sectionId: number) => invoke('db:line-items:list', sectionId),
  saveBidLineItem: (item: any) => invoke('db:line-items:save', item),
  deleteBidLineItem: (id: number) => invoke('db:line-items:delete', id),
  importBidItems: (jobId: number, sectionId: number, items: any[]) =>
    invoke('db:line-items:import', jobId, sectionId, items),

  getBidSummary: (jobId: number) => invoke('db:jobs:summary', jobId),
  getBidSummaryBatch: (jobIds: number[]) => invoke('db:jobs:summary-batch', jobIds),

  // ---- Trench Profiles ----
  getTrenchProfiles: (jobId: number) => invoke('db:trench-profiles:list', jobId),
  saveTrenchProfile: (profile: any) => invoke('db:trench-profiles:save', profile),
  deleteTrenchProfile: (id: number) => invoke('db:trench-profiles:delete', id),
  reorderTrenchProfiles: (items: any[]) => invoke('db:trench-profiles:reorder', items),

  // ---- Assemblies ----
  getAssemblies: () => invoke('db:assemblies:list'),
  getAssembly: (id: number) => invoke('db:assemblies:get', id),
  saveAssembly: (assembly: any) => invoke('db:assemblies:save', assembly),
  deleteAssembly: (id: number) => invoke('db:assemblies:delete', id),

  // ---- Settings ----
  getSettings: () => invoke('db:settings:get'),
  saveSettings: (settings: any) => invoke('db:settings:save', settings),
  chooseLogoFile: () => invoke('db:settings:choose-logo'),

  // ---- Setup ----
  isSetupComplete: () => invoke('db:setup:is-complete'),
  runSetup: (trades: string[], includeBallparkPrices: boolean, companyName: string, localOnlyMode?: boolean) =>
    invoke('db:setup:run', trades, includeBallparkPrices, companyName, localOnlyMode),

  // ---- CSV Import ----
  openCsvFile: () => invoke('db:csv:open'),
  parseCsvPath: (filePath: string) => invoke('db:csv:parse-path', filePath),
  importPriceSheet: (updates: any[], source: string) =>
    invoke('db:materials:import-prices', updates, source),

  // ---- Plan Takeoff ----
  openTakeoffPdf: () => invoke('db:takeoff:open-pdf'),
  readTakeoffPdf: (filePath: string) => invoke('db:takeoff:read-pdf', filePath),
  getTakeoffSettings: (jobId: number) => invoke('db:takeoff-settings:get', jobId),
  saveTakeoffSettings: (settings: any) => invoke('db:takeoff-settings:save', settings),
  getPageScale: (jobId: number, pageNumber: number) => invoke('db:takeoff-page-scale:get', jobId, pageNumber),
  savePageScale: (data: any) => invoke('db:takeoff-page-scale:save', data),
  listPageScales: (jobId: number) => invoke('db:takeoff-page-scale:list', jobId),
  listTakeoffRuns: (jobId: number) => invoke('db:takeoff-runs:list', jobId),
  saveTakeoffRun: (run: any) => invoke('db:takeoff-runs:save', run),
  deleteTakeoffRun: (id: number) => invoke('db:takeoff-runs:delete', id),
  updateTakeoffPoint: (data: any) => invoke('db:takeoff-points:update', data),
  listTakeoffItems: (jobId: number) => invoke('db:takeoff-items:list', jobId),
  saveTakeoffItem: (item: any) => invoke('db:takeoff-items:save', item),
  deleteTakeoffItem: (id: number) => invoke('db:takeoff-items:delete', id),
  listTakeoffAreas: (jobId: number) => invoke('db:takeoff-areas:list', jobId),
  saveTakeoffArea: (area: any) => invoke('db:takeoff-areas:save', area),
  deleteTakeoffArea: (id: number) => invoke('db:takeoff-areas:delete', id),
  exportTakeoffCsv: (jobId: number, csvContent: string) => invoke('takeoff:export-csv', jobId, csvContent),
  replaceTakeoffState: (jobId: number, state: any) => invoke('db:takeoff:replace-state', jobId, state),
  listTakeoffAnnotations: (jobId: number) => invoke('db:takeoff-annotations:list', jobId),
  saveTakeoffAnnotation: (ann: any) => invoke('db:takeoff-annotations:save', ann),
  deleteTakeoffAnnotation: (id: number) => invoke('db:takeoff-annotations:delete', id),
  getPageRotation: (jobId: number, pageNumber: number) => invoke('db:takeoff-page-rotation:get', jobId, pageNumber),
  savePageRotation: (jobId: number, pageNumber: number, rotation: number) => invoke('db:takeoff-page-rotation:save', jobId, pageNumber, rotation),
  listTakeoffNodes: (jobId: number) => invoke('db:takeoff-nodes:list', jobId),
  saveTakeoffNode: (node: any) => invoke('db:takeoff-nodes:save', node),
  deleteTakeoffNode: (id: number) => invoke('db:takeoff-nodes:delete', id),
  getNodeConnectedRuns: (nodeId: number) => invoke('db:takeoff-nodes:connected-runs', nodeId),

  // ---- Quotes ----
  getQuotes: (jobId: number) => invoke('db:quotes:list', jobId),
  saveQuote: (quote: any) => invoke('db:quotes:save', quote),
  selectQuote: (jobId: number, scope: string, quoteId: number | null) => invoke('db:quotes:select', jobId, scope, quoteId),
  deleteQuote: (id: number) => invoke('db:quotes:delete', id),

  // ---- Export ----
  exportQuickBooksCSV: (jobId: number) => invoke('export:quickbooks-csv', jobId),
  exportUnitPriceCSV: (jobId: number) => invoke('export:unit-price-csv', jobId),
  saveCsv: (defaultName: string, title: string, csvContent: string) => invoke('export:save-csv', defaultName, title, csvContent),
  exportBidPdf: (jobId: number) => invoke('jobs:export-pdf', jobId),
  printBid: (jobId: number) => invoke('jobs:print-bid', jobId),

  // ---- Backup/Restore ----
  exportDatabase: () => invoke('db:export'),
  restoreDatabase: () => invoke('db:restore'),
  checkBackupReminder: () => invoke('db:settings:backup-reminder-needed'),
  dismissBackupReminder: () => invoke('db:settings:dismiss-backup-reminder'),

  // ---- App Info ----
  getLogDir: () => invoke('app:log-dir'),

  // ---- Updates ----
  checkForUpdate: () => invoke('updater:check'),
  downloadUpdate: () => invoke('updater:download'),
  installUpdate: () => invoke('updater:install'),
  getAppVersion: () => invoke('updater:get-version'),
  onUpdateStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('update-status', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // ---- Cloud Sync ----
  cloudStatus: () => invoke('cloud:status'),
  cloudSignUp: (email: string, password: string) => invoke('cloud:sign-up', email, password),
  cloudSignIn: (email: string, password: string) => invoke('cloud:sign-in', email, password),
  cloudEnrollTotp: () => invoke('cloud:enroll-totp'),
  cloudVerifyTotp: (code: string, factorId?: string) => invoke('cloud:verify-totp', code, factorId),
  cloudSignOut: () => invoke('cloud:sign-out'),
  cloudMe: () => invoke('cloud:me'),
  cloudBillingCheckout: () => invoke('cloud:billing-checkout'),
  cloudBillingPortal: () => invoke('cloud:billing-portal'),
  cloudSyncNow: () => invoke('cloud:sync-now'),
  cloudEnableJob: (jobId: number) => invoke('cloud:job-enable', jobId),
  cloudDisableJob: (jobId: number) => invoke('cloud:job-disable', jobId),
  cloudPushJob: (jobId: number) => invoke('cloud:job-push', jobId),
  cloudPullJob: (cloudId: string) => invoke('cloud:job-pull', cloudId),
  cloudResolveConflict: (jobId: number, keep: 'local' | 'cloud') =>
    invoke('cloud:resolve-conflict', jobId, keep),
  onCloudSyncStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cloud-sync-status', handler);
    return () => ipcRenderer.removeListener('cloud-sync-status', handler);
  },

});
