import { contextBridge, ipcRenderer, webUtils } from 'electron';

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
  replaceBidState: (jobId: number, state: any) => invoke('db:bid:replace-state', jobId, state),

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
  // Electron 32+ removed File.path; webUtils.getPathForFile is the supported
  // way to resolve a drag-and-dropped file to its real filesystem path.
  getDroppedFilePath: (file: File): string => webUtils.getPathForFile(file),
  importPriceSheet: (updates: any[], source: string) =>
    invoke('db:materials:import-prices', updates, source),

  // ---- Per-job price import (reconciliation) ----
  priceImportContext: (jobId: number) => invoke('db:price-import:context', jobId),
  priceImportCommit: (jobId: number, payload: any) => invoke('db:price-import:commit', jobId, payload),

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
  listTakeoffWalls: (jobId: number) => invoke('db:takeoff-walls:list', jobId),
  saveTakeoffWall: (wall: any) => invoke('db:takeoff-walls:save', wall),
  deleteTakeoffWall: (id: number) => invoke('db:takeoff-walls:delete', id),
  listTakeoffSurfaces: (jobId: number) => invoke('db:takeoff-surfaces:list', jobId),
  saveTakeoffSurface: (s: any) => invoke('db:takeoff-surfaces:save', s),
  deleteTakeoffSurface: (id: number) => invoke('db:takeoff-surfaces:delete', id),
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
  getQuoteVendors: () => invoke('db:quotes:vendors'),

  // ---- Section templates ----
  getSectionTemplates: () => invoke('db:section-templates:list'),
  saveSectionTemplate: (sectionId: number, name: string) =>
    invoke('db:section-templates:save-from-section', sectionId, name),
  deleteSectionTemplate: (id: number) => invoke('db:section-templates:delete', id),
  insertSectionTemplate: (templateId: number, jobId: number) =>
    invoke('db:section-templates:insert-into-job', templateId, jobId),

  // ---- Indirect costs ----
  getIndirectCosts: (jobId: number) => invoke('db:indirects:list', jobId),
  saveIndirectCost: (indirect: any) => invoke('db:indirects:save', indirect),
  deleteIndirectCost: (id: number) => invoke('db:indirects:delete', id),

  // ---- Job documents ----
  listJobDocuments: (jobId: number) => invoke('db:documents:list', jobId),
  addJobDocuments: (jobId: number, category: string) => invoke('db:documents:add', jobId, category),
  addJobDocumentPaths: (jobId: number, paths: string[], category: string) =>
    invoke('db:documents:add-paths', jobId, paths, category),
  openJobDocument: (id: number) => invoke('db:documents:open', id),
  revealJobDocument: (id: number) => invoke('db:documents:reveal', id),
  updateJobDocument: (id: number, fields: { category?: string; notes?: string | null }) =>
    invoke('db:documents:update', id, fields),
  deleteJobDocument: (id: number) => invoke('db:documents:delete', id),

  // ---- Export ----
  exportQuickBooksCSV: (jobId: number) => invoke('export:quickbooks-csv', jobId),
  exportUnitPriceCSV: (jobId: number) => invoke('export:unit-price-csv', jobId),
  saveCsv: (defaultName: string, title: string, csvContent: string) => invoke('export:save-csv', defaultName, title, csvContent),
  exportBidPdf: (jobId: number) => invoke('jobs:export-pdf', jobId),
  printBid: (jobId: number) => invoke('jobs:print-bid', jobId),
  getPdfHtml: (jobId: number, template: any) => invoke('jobs:get-pdf-html', jobId, template),
  getPdfTemplate: () => invoke('settings:get-pdf-template'),
  savePdfTemplate: (template: any) => invoke('settings:save-pdf-template', template),
  exportBidPdfWithTemplate: (jobId: number, template: any) => invoke('jobs:export-pdf', jobId, template),

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
  cloudRestoreAll: () => invoke('cloud:restore-all'),
  cloudE2eeState: () => invoke('cloud:e2ee-state'),
  cloudE2eeSetup: (shorter?: boolean) => invoke('cloud:e2ee-setup', shorter),
  cloudE2eeUnlock: (recoveryKey: string) => invoke('cloud:e2ee-unlock', recoveryKey),
  cloudE2eeRegenerateRecovery: (shorter?: boolean) =>
    invoke('cloud:e2ee-regenerate-recovery', shorter),
  cloudOrgMembers: () => invoke('cloud:org-members'),
  cloudOrgCreateInvite: (role?: 'member' | 'owner') => invoke('cloud:org-create-invite', role),
  cloudOrgListInvites: () => invoke('cloud:org-list-invites'),
  cloudOrgRevokeInvite: (id: string) => invoke('cloud:org-revoke-invite', id),
  cloudOrgRedeemInvite: (token: string, shorter?: boolean) =>
    invoke('cloud:org-redeem-invite', token, shorter),
  cloudOrgApproveMember: (userId: string) => invoke('cloud:org-approve-member', userId),
  cloudOrgRemoveMember: (userId: string) => invoke('cloud:org-remove-member', userId),
  cloudBackupStatus: () => invoke('cloud:backup-status'),
  cloudBackupNow: () => invoke('cloud:backup-now'),
  cloudBackupDisable: () => invoke('cloud:backup-disable'),
  cloudBackupRestore: (recoveryKey: string) => invoke('cloud:backup-restore', recoveryKey),
  onCloudSyncStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cloud-sync-status', handler);
    return () => ipcRenderer.removeListener('cloud-sync-status', handler);
  },
  onCloudCatalogUpdated: (callback: (data: { applied: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cloud-catalog-updated', handler);
    return () => ipcRenderer.removeListener('cloud-catalog-updated', handler);
  },

});
