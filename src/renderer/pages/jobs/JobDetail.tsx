import React, { useState, useEffect, useCallback } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { LineItemModal } from './LineItemModal';
import { EditJobModal, type EditJobForm } from './EditJobModal';
import { ChangeOrdersTab } from './ChangeOrdersTab';
import { AssemblyPickerModal } from './AssemblyPickerModal';
import { emptyLineForm, jobToPayload, formatCurrency, formatDateLocal } from './helpers';
import { buildAssemblyLineItems } from '../../../shared/assemblyExpansion';
import { buildLineItemPayload, lineItemRowToPayload } from '../../../shared/lineItemPayload';
import { parseManualFields, withManual } from '../../../shared/manualFields';
import { effectiveMaterialUnitCost } from '../../../shared/unitConversion';
import { BidGrid } from './BidGrid';
import { SectionSettingsModal } from './SectionSettingsModal';
import { TakeoffSummaryCard } from './TakeoffSummaryCard';
import { QuotesTab } from './QuotesTab';
import { CostCodeReportModal } from './CostCodeReportModal';
import { BidItemImportModal } from './BidItemImportModal';
import { JobPriceImportModal } from './JobPriceImportModal';
import { PriceStateLegend } from './priceState';
import { CompareJobsModal } from './CompareJobsModal';
import { TrenchProfileList, type ConvertToBidProfile } from './TrenchProfileList';
import { useToastStore } from '../../stores/toast-store';
import { useBidHistory, type BidSnapshot } from './useBidHistory';

// Lock icon SVGs -- inline to avoid any import dependency
const LockClosedIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const LockOpenIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

interface JobDetailProps {
  jobId: number;
  onBack: () => void;
  onOpenJob: (id: number) => void;
  onOpenTakeoff?: () => void;
}

export function JobDetail({ jobId, onBack, onOpenJob, onOpenTakeoff }: JobDetailProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [job, setJob] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [lineItems, setLineItems] = useState<Record<number, any[]>>({});
  const [summary, setSummary] = useState<any>(null);
  const [changeOrders, setChangeOrders] = useState<any[]>([]);
  const [coSummaries, setCoSummaries] = useState<Record<number, any>>({});
  const [parentJob, setParentJob] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'estimate' | 'profiles' | 'quotes' | 'changes'>('estimate');
  const [showCostCodeReport, setShowCostCodeReport] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [profileCount, setProfileCount] = useState(0);
  const [showAddSection, setShowAddSection] = useState(false);
  const [showBidItemImport, setShowBidItemImport] = useState(false);
  const [showPriceImport, setShowPriceImport] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [showLineItemModal, setShowLineItemModal] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<any>(null);
  const [lineForm, setLineForm] = useState(emptyLineForm());

  // Catalog data for pickers
  const [materials, setMaterials] = useState<any[]>([]);
  const [crews, setCrews] = useState<any[]>([]);
  const [productionRates, setProductionRates] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [assemblies, setAssemblies] = useState<any[]>([]);

  // Assembly picker state
  const [showAssemblyPicker, setShowAssemblyPicker] = useState(false);
  const [assemblySectionId, setAssemblySectionId] = useState<number | null>(null);

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void; onNo?: () => void; yesLabel?: string; variant?: 'danger' | 'neutral' } | null>(null);
  const [showEditJob, setShowEditJob] = useState(false);
  const [editJobForm, setEditJobForm] = useState<EditJobForm>({
    name: '', jobNumber: '', client: '', location: '', bidDate: '', description: '',
    overheadPercent: 0, profitPercent: 0, bondPercent: 0, taxPercent: 0, escalationPercent: 0,
  });
  const [lockBypassed, setLockBypassed] = useState(false);

  // Derived: bid is effectively locked when job is won or lost, bid_locked=1, and user hasn't bypassed this session
  const isLocked = (job?.status === 'won' || job?.status === 'lost') && job?.bid_locked === 1 && !lockBypassed;

  // Gate any destructive/edit action behind a soft lock warning.
  // onCancel fires when the user declines, so promise-based callers can settle.
  const withLockCheck = (action: () => void, onCancel?: () => void) => {
    if (isLocked) {
      setConfirmState({
        msg: 'This bid is locked. Edit anyway?',
        yesLabel: 'Edit Anyway',
        variant: 'neutral',
        onYes: () => { setConfirmState(null); setLockBypassed(true); action(); },
        onNo: onCancel,
      });
    } else {
      action();
    }
  };

  const loadJob = useCallback(async () => {
    try {
      const [j, s, mats, cr, pr, eq, set, asm] = await Promise.all([
        window.api.getJob(jobId),
        window.api.getBidSections(jobId),
        window.api.getMaterials(),
        window.api.getCrewTemplates(),
        window.api.getProductionRates(),
        window.api.getEquipment(),
        window.api.getSettings(),
        window.api.getAssemblies(),
      ]);
      if (!j) {
        addToast('Job not found.', 'error');
        return;
      }
      setJob(j);
      setSections(s);
      setMaterials(mats);
      setCrews(cr);
      setProductionRates(pr);
      setEquipment(eq);
      setSettings(set);
      setAssemblies(asm);
      const items: Record<number, any[]> = {};
      for (const sec of s) {
        items[sec.id] = await window.api.getBidLineItems(sec.id);
      }
      setLineItems(items);
      const sum = await window.api.getBidSummary(jobId);
      setSummary(sum);
      const profs = await window.api.getTrenchProfiles(jobId);
      setProfileCount(profs.length);

      // Load change orders if this is a parent job
      if (!j.parent_job_id) {
        const cos = await window.api.getChangeOrders(jobId);
        setChangeOrders(cos);
        const cosums: Record<number, any> = {};
        for (const co of cos) {
          cosums[co.id] = await window.api.getBidSummary(co.id);
        }
        setCoSummaries(cosums);
      } else {
        setChangeOrders([]);
        setCoSummaries({});
      }

      // Load parent job if this is a CO
      if (j.parent_job_id) {
        const p = await window.api.getJob(j.parent_job_id);
        setParentJob(p ?? null);
      } else {
        setParentJob(null);
      }
    } catch (err: any) {
      addToast(err?.message || 'Failed to load job data.', 'error');
    }
  }, [jobId, addToast]);

  // ---- Undo/redo: snapshot history over sections + line items ----
  const getBidState = useCallback<() => BidSnapshot>(
    () => ({ sections, lineItems }),
    [sections, lineItems],
  );
  const history = useBidHistory({ jobId, getState: getBidState, reloadAll: loadJob });

  useEffect(() => {
    loadJob();
    setLockBypassed(false);
    setActiveTab('estimate');
  }, [loadJob]);

  const updateStatus = async (status: 'draft' | 'submitted' | 'won' | 'lost' | 'archived') => {
    if (!job) return;
    // Auto-lock when marking won or lost, unless the setting is disabled
    const shouldAutoLock = (status === 'won' || status === 'lost') && settings?.auto_lock_on_close !== 0;
    const bidLocked = shouldAutoLock ? true : jobToPayload(job).bidLocked;
    if (shouldAutoLock) setLockBypassed(false);
    await window.api.saveJob({ ...jobToPayload(job), status, bidLocked });
    loadJob();
  };

  const toggleMasterLock = async () => {
    if (!job) return;
    const newLocked = job.bid_locked !== 1;
    if (newLocked) {
      // Re-locking: reset session bypass
      setLockBypassed(false);
    }
    setConfirmState({
      msg: newLocked
        ? 'Lock this bid? Future edits will require confirmation.'
        : 'Permanently unlock this bid? Edits will no longer require confirmation.',
      yesLabel: newLocked ? 'Lock Bid' : 'Unlock Bid',
      variant: 'neutral',
      onYes: async () => {
        setConfirmState(null);
        await window.api.saveJob({ ...jobToPayload(job), bidLocked: newLocked });
        loadJob();
      },
    });
  };

  // ---- Edit Job Info ----
  const openEditJob = () => {
    if (!job) return;
    setEditJobForm({
      name: job.name || '',
      jobNumber: job.job_number || '',
      client: job.client || '',
      location: job.location || '',
      bidDate: job.bid_date ? job.bid_date.slice(0, 10) : '',
      description: job.description || '',
      overheadPercent: job.overhead_percent ?? 0,
      profitPercent: job.profit_percent ?? 0,
      bondPercent: job.bond_percent ?? 0,
      taxPercent: job.tax_percent ?? 0,
      escalationPercent: job.escalation_percent ?? 0,
    });
    setShowEditJob(true);
  };

  const saveJobInfo = async () => {
    if (!job || !editJobForm.name.trim()) return;
    await window.api.saveJob({
      ...jobToPayload(job),
      name: editJobForm.name.trim(),
      jobNumber: editJobForm.jobNumber || null,
      // jobs.client is NOT NULL — binding null throws a constraint error
      client: editJobForm.client || '',
      location: editJobForm.location || null,
      bidDate: editJobForm.bidDate || null,
      description: editJobForm.description || null,
      overheadPercent: editJobForm.overheadPercent,
      profitPercent: editJobForm.profitPercent,
      bondPercent: editJobForm.bondPercent,
      taxPercent: editJobForm.taxPercent,
      escalationPercent: editJobForm.escalationPercent,
    });
    setShowEditJob(false);
    loadJob();
  };

  // ---- Quotes → bid ----
  const handleSendQuotesToBid = async (selected: { scope: string; vendor: string; amount: number; notes: string | null }[]) => {
    if (selected.length === 0) return;
    history.record();
    const sectionResult = await window.api.saveBidSection({
      jobId,
      name: 'Subcontractors',
      sortOrder: sections.length,
    });
    let sortOrder = 0;
    for (const q of selected) {
      await window.api.saveBidLineItem(buildLineItemPayload({
        sectionId: sectionResult.id,
        jobId,
        description: `${q.scope} — ${q.vendor}`,
        quantity: 1,
        unit: 'LS',
        sortOrder: sortOrder++,
        subcontractorCost: q.amount,
        notes: q.notes ? `Quote: ${q.notes}` : 'From quote tracking',
      }));
    }
    await loadJob();
  };

  // ---- Unit price schedule export ----
  const handleExportUnitPrices = async () => {
    try {
      const result = await window.api.exportUnitPriceCSV(jobId);
      if (result.success) {
        addToast(`Unit price schedule saved to ${result.path}`, 'success');
      } else if (result.error) {
        addToast(result.error, 'error');
      }
    } catch (err: any) {
      addToast(err.message || 'Export failed', 'error');
    }
  };

  // ---- Sections ----
  const addSection = async () => {
    if (!newSectionName.trim()) return;
    history.record();
    await window.api.saveBidSection({ jobId, name: newSectionName, sortOrder: sections.length });
    setNewSectionName('');
    setShowAddSection(false);
    loadJob();
  };

  const [editingSection, setEditingSection] = useState<any>(null);

  // Single gate for "is any modal/overlay open" — keeps the keyboard-shortcut
  // effect's deps to one value instead of an easy-to-forget list, so adding a
  // future modal only requires updating this one expression.
  const anyModalOpen = !!(showLineItemModal || editingSection || showEditJob || showAssemblyPicker
    || showBidItemImport || showPriceImport || showCompare || showCostCodeReport || confirmState);

  // Ctrl/Cmd+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo — estimate tab only, and
  // never while focus is in an editable field or a modal is open (so inline
  // cell editors keep their own native text undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeTab !== 'estimate') return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (!mod || (key !== 'z' && key !== 'y')) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (anyModalOpen) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, history, anyModalOpen]);

  const openSectionSettings = (section: any) => {
    withLockCheck(() => setEditingSection(section));
  };

  const saveSectionSettings = async (payload: {
    name: string;
    isAlternate: boolean;
    overheadPercentOverride: number | null;
    profitPercentOverride: number | null;
    bondPercentOverride: number | null;
  }) => {
    if (!editingSection) return;
    history.record();
    await window.api.saveBidSection({
      id: editingSection.id,
      jobId,
      sortOrder: editingSection.sort_order,
      ...payload,
    });
    setEditingSection(null);
    loadJob();
  };

  const deleteSection = (id: number) => {
    withLockCheck(() => {
      setConfirmState({
        msg: 'Delete this section and all its line items?',
        onYes: async () => {
          setConfirmState(null);
          history.record();
          await window.api.deleteBidSection(id);
          loadJob();
        },
      });
    });
  };

  // ---- Line Items ----
  const openAddLineItem = (sectionId: number) => {
    withLockCheck(() => {
      setEditingSectionId(sectionId);
      setEditingLineItem(null);
      setLineForm(emptyLineForm());
      setShowLineItemModal(true);
    });
  };

  const openEditLineItem = (item: any) => {
    withLockCheck(() => {
      setEditingSectionId(item.section_id);
      setEditingLineItem(item);
      setLineForm({
        description: item.description,
        itemNumber: item.item_number || '',
        costCode: item.cost_code || '',
        quantity: item.quantity,
        unit: item.unit,
        materialId: item.material_id || 0,
        materialUnitCost: item.material_unit_cost,
        crewTemplateId: item.crew_template_id || 0,
        productionRateId: item.production_rate_id || 0,
        laborHours: item.labor_hours,
        laborCostPerHour: item.labor_cost_per_hour,
        equipmentId: item.equipment_id || 0,
        equipmentHours: item.equipment_hours,
        equipmentCostPerHour: item.equipment_cost_per_hour,
        subcontractorCost: item.subcontractor_cost,
        notes: item.notes || '',
        manualFields: parseManualFields(item.manual_fields),
      });
      setShowLineItemModal(true);
    });
  };

  const saveLineItem = async () => {
    const sectionItems = lineItems[editingSectionId!] || [];
    history.record();
    await window.api.saveBidLineItem({
      id: editingLineItem?.id,
      sectionId: editingSectionId!,
      jobId,
      description: lineForm.description,
      itemNumber: lineForm.itemNumber || null,
      costCode: lineForm.costCode || null,
      quantity: lineForm.quantity,
      unit: lineForm.unit,
      sortOrder: editingLineItem?.sort_order ?? sectionItems.length,
      materialId: lineForm.materialId || null,
      materialUnitCost: lineForm.materialUnitCost,
      crewTemplateId: lineForm.crewTemplateId || null,
      productionRateId: lineForm.productionRateId || null,
      laborHours: lineForm.laborHours,
      laborCostPerHour: lineForm.laborCostPerHour,
      equipmentId: lineForm.equipmentId || null,
      equipmentCostPerHour: lineForm.equipmentCostPerHour,
      equipmentHours: lineForm.equipmentHours,
      subcontractorCost: lineForm.subcontractorCost,
      notes: lineForm.notes || null,
      manualFields: lineForm.manualFields || [],
    });
    setShowLineItemModal(false);
    loadJob();
  };

  // Inline cell edit from the bid grid (quantity / material unit price). Builds
  // the full save payload from the existing row so the server recomputes
  // totals, and records a history snapshot first so the edit is undoable.
  const commitInlineEdit = async (item: any, changes: { quantity?: number; materialUnitCost?: number }) => {
    try {
      history.record();
      // Typing over the material unit price in the grid is an override; mark it
      // sticky so a later quantity/material change won't recompute it.
      const manualFields = changes.materialUnitCost != null
        ? withManual(parseManualFields(item.manual_fields), 'materialUnitCost', true)
        : parseManualFields(item.manual_fields);
      await window.api.saveBidLineItem(lineItemRowToPayload(item, {
        jobId,
        quantity: changes.quantity ?? item.quantity,
        materialUnitCost: changes.materialUnitCost ?? item.material_unit_cost,
        manualFields,
      }));
      await loadJob();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save edit.', 'error');
      await loadJob().catch(() => { /* already reporting the primary error */ });
    }
  };

  const deleteLineItem = (id: number) => {
    withLockCheck(() => {
      setConfirmState({
        msg: 'Delete this line item?',
        onYes: async () => {
          setConfirmState(null);
          history.record();
          await window.api.deleteBidLineItem(id);
          await loadJob();
          setLockBypassed(false);
        },
      });
    });
  };

  // ---- Assembly picker ----
  const openAssemblyPicker = (sectionId: number) => {
    withLockCheck(() => {
      setAssemblySectionId(sectionId);
      setShowAssemblyPicker(true);
    });
  };

  const addAssemblyToSection = async (assemblyId: number, qty: number) => {
    if (!assemblySectionId) return;
    const assembly = assemblies.find((a: any) => a.id === assemblyId);
    if (!assembly) return;
    history.record();
    const sectionItems = lineItems[assemblySectionId] || [];
    let sortOrder = sectionItems.length;

    for (const payload of buildAssemblyLineItems(assembly, qty, crews)) {
      await window.api.saveBidLineItem({
        sectionId: assemblySectionId,
        jobId,
        sortOrder: sortOrder++,
        ...payload,
      });
    }

    setShowAssemblyPicker(false);
    loadJob();
  };

  // ---- Convert trench profiles to bid sections ----
  const handleConvertToBid = async (profileData: ConvertToBidProfile[]) => {
    history.record();
    const tracerMat = materials.find((m: any) => m.name.toLowerCase().includes('tracer wire'));
    const tapeMat = materials.find((m: any) => m.name.toLowerCase().includes('warning tape'));

    // Aggregate pipe LF by material (different pipe sizes/types get separate line items)
    const pipeByKey = new Map<string, { qty: number; materialId: number | null; name: string; labels: string[] }>();
    let totalExcavationCY = 0;
    const beddingByKey = new Map<string, { qty: number; materialId: number | null; name: string; unit: string; labels: string[] }>();
    const backfillByKey = new Map<string, { qty: number; materialId: number | null; name: string; unit: string; labels: string[] }>();
    let totalTracerLF = 0;
    let totalTapeLF = 0;

    for (const p of profileData) {
      // Pipe -- group by material ID (or name for legacy)
      const pipeKey = p.pipeMaterialId != null ? String(p.pipeMaterialId) : p.pipeMaterialName;
      const pipeEntry = pipeByKey.get(pipeKey);
      if (pipeEntry) {
        pipeEntry.qty += p.pipeLF;
        pipeEntry.labels.push(p.label);
      } else {
        pipeByKey.set(pipeKey, { qty: p.pipeLF, materialId: p.pipeMaterialId, name: p.pipeMaterialName, labels: [p.label] });
      }

      totalExcavationCY += p.excavationCY;

      // Bedding -- group by material ID
      const bedKey = p.beddingMaterialId != null ? String(p.beddingMaterialId) : p.beddingMaterialName;
      const bedEntry = beddingByKey.get(bedKey);
      if (bedEntry) {
        bedEntry.qty += p.beddingCY;
        bedEntry.labels.push(p.label);
      } else {
        beddingByKey.set(bedKey, { qty: p.beddingCY, materialId: p.beddingMaterialId, name: p.beddingMaterialName, unit: p.beddingMaterialUnit, labels: [p.label] });
      }

      // Backfill -- group by material ID
      const bfKey = p.backfillMaterialId != null ? String(p.backfillMaterialId) : p.backfillMaterialName;
      const bfEntry = backfillByKey.get(bfKey);
      if (bfEntry) {
        bfEntry.qty += p.backfillCY;
        bfEntry.labels.push(p.label);
      } else {
        backfillByKey.set(bfKey, { qty: p.backfillCY, materialId: p.backfillMaterialId, name: p.backfillMaterialName, unit: p.backfillMaterialUnit, labels: [p.label] });
      }

      totalTracerLF += p.tracerWireLF;
      totalTapeLF += p.warningTapeLF;
    }

    const allLabels = profileData.map((p) => p.label).join(', ');
    const profileNote = `From trench profiles: ${allLabels}`;

    // Create one bid section
    const sectionResult = await window.api.saveBidSection({
      jobId,
      name: 'Trench Work',
      sortOrder: sections.length,
    });
    const sectionId = sectionResult.id;
    let sortOrder = 0;

    const saveItem = (opts: { description: string; quantity: number; unit: string; materialId: number | null; materialUnitCost: number; notes: string }) =>
      window.api.saveBidLineItem(buildLineItemPayload({
        sectionId, jobId, sortOrder: sortOrder++,
        description: opts.description, quantity: opts.quantity, unit: opts.unit,
        materialId: opts.materialId, materialUnitCost: opts.materialUnitCost,
        notes: opts.notes,
      }));

    // Pipe line items (one per material type)
    for (const entry of pipeByKey.values()) {
      const mat = entry.materialId ? materials.find((m: any) => m.id === entry.materialId) : null;
      await saveItem({
        description: entry.name, quantity: entry.qty, unit: 'LF',
        materialId: entry.materialId, materialUnitCost: mat?.default_unit_cost || 0,
        notes: profileNote,
      });
    }

    // Excavation (single total)
    await saveItem({
      description: 'Excavation', quantity: totalExcavationCY, unit: 'CY',
      materialId: null, materialUnitCost: 0, notes: profileNote,
    });

    // Bedding/backfill line items (one per material type). Quantities
    // are CY; TON-priced aggregates use their per-CY price when one is
    // set, otherwise the price is left at 0 with a note.
    const volumeItem = (entry: { qty: number; materialId: number | null; name: string }) => {
      const mat = entry.materialId ? materials.find((m: any) => m.id === entry.materialId) : null;
      let unitCost = 0;
      let note = profileNote;
      if (mat) {
        const eff = effectiveMaterialUnitCost(mat, 'CY');
        if (mat.unit === 'CY' || mat.unit === 'CYD') {
          unitCost = mat.default_unit_cost;
        } else if (eff.converted) {
          unitCost = eff.cost;
          note = `${profileNote} | Catalog price ${formatCurrency(mat.default_unit_cost)}/${mat.unit}, using ${formatCurrency(eff.cost)}/CY`;
        } else {
          note = `${profileNote} | Catalog unit is ${mat.unit} -- adjust pricing manually`;
        }
      }
      return saveItem({
        description: entry.name, quantity: entry.qty, unit: 'CY',
        materialId: entry.materialId, materialUnitCost: unitCost, notes: note,
      });
    };

    for (const entry of beddingByKey.values()) {
      await volumeItem(entry);
    }

    for (const entry of backfillByKey.values()) {
      await volumeItem(entry);
    }

    // Tracer Wire (single total)
    await saveItem({
      description: tracerMat?.name || 'Tracer Wire', quantity: totalTracerLF, unit: 'LF',
      materialId: tracerMat?.id || null, materialUnitCost: tracerMat?.default_unit_cost || 0,
      notes: profileNote,
    });

    // Warning Tape (single total)
    await saveItem({
      description: tapeMat?.name || 'Warning Tape', quantity: totalTapeLF, unit: 'LF',
      materialId: tapeMat?.id || null, materialUnitCost: tapeMat?.default_unit_cost || 0,
      notes: profileNote,
    });

    await loadJob();
  };

  // ---- Change Orders ----
  const isChangeOrder = !!job?.parent_job_id;

  const handleCreateCO = async () => {
    const result = await window.api.createChangeOrder(jobId);
    if (result?.newJobId) {
      await loadJob();
      onOpenJob(result.newJobId);
    }
  };

  const handleDeleteCO = (co: any) => {
    withLockCheck(() => {
      setConfirmState({
        msg: `Delete CO #${co.change_order_number} and all its bid data? This cannot be undone.`,
        onYes: async () => {
          setConfirmState(null);
          await window.api.deleteJob(co.id);
          loadJob();
        },
      });
    });
  };

  // Revised total: original bid + approved (won) COs
  const approvedCOTotal = changeOrders
    .filter((co) => co.status === 'won')
    .reduce((sum, co) => sum + (coSummaries[co.id]?.grandTotal || 0), 0);
  const revisedTotal = summary ? summary.grandTotal + approvedCOTotal : 0;

  // ---- Print ----
  const [printing, setPrinting] = useState(false);
  const handlePrint = async () => {
    setPrinting(true);
    try {
      await window.api.printBid(jobId);
    } catch (err: any) {
      addToast(err.message || 'Print failed', 'error');
    } finally {
      setPrinting(false);
    }
  };

  // ---- QuickBooks Export ----
  const handleExportQB = async () => {
    try {
      const result = await window.api.exportQuickBooksCSV(jobId);
      if (result.success) {
        addToast(`Exported to ${result.path}`, 'success');
      } else if (result.error) {
        addToast(result.error, 'error');
      }
    } catch (err: any) {
      addToast(err.message || 'Export failed', 'error');
    }
  };

  // ---- PDF Export ----
  const [pdfExporting, setPdfExporting] = useState(false);
  const handleExportPdf = async () => {
    setPdfExporting(true);
    try {
      const result = await window.api.exportBidPdf(jobId);
      if (result.success && result.filePath) {
        addToast(`PDF saved to ${result.filePath}`, 'success');
      }
    } catch (err: any) {
      addToast(err.message || 'PDF export failed', 'error');
    } finally {
      setPdfExporting(false);
    }
  };


  if (!job) return <p className="text-muted">Loading job...</p>;

  return (
    <div className="job-detail-page">
      <div className="page-header no-print">
        <div>
          {isChangeOrder && parentJob ? (
            <button className="btn btn-sm btn-secondary mb-16" onClick={() => onOpenJob(parentJob.id)}>
              &#8592; Back to {parentJob.name}
            </button>
          ) : (
            <button className="btn btn-sm btn-secondary mb-16" onClick={onBack}>&#8592; Back to Jobs</button>
          )}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            {isChangeOrder && (
              <span className="badge badge-submitted" style={{ fontSize: 11 }}>CO #{job.change_order_number}</span>
            )}
            <h2 style={{ margin: 0 }}>{job.name}</h2>
            <button className="btn btn-ghost" onClick={openEditJob}>Edit</button>
            {onOpenTakeoff && (
              <button className="btn btn-sm btn-secondary" onClick={onOpenTakeoff} style={{ fontSize: 12 }}>Plan Takeoff</button>
            )}
          </div>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            {job.client && <span>{job.client}</span>}
            {job.location && <span> &middot; {job.location}</span>}
            {job.bid_date && <span> &middot; Due {formatDateLocal(job.bid_date)}</span>}
          </div>
        </div>
        <div className="flex gap-8">
          <button
            className="btn btn-sm btn-secondary"
            onClick={toggleMasterLock}
            title={job.bid_locked === 1 ? 'Bid locked -- click to permanently unlock' : 'Bid unlocked -- click to lock'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: job.bid_locked === 1 ? 'var(--warning, #f59e0b)' : 'var(--text-muted)' }}
          >
            {job.bid_locked === 1 ? <LockClosedIcon /> : <LockOpenIcon />}
          </button>
          <button className="btn btn-secondary" onClick={handlePrint} disabled={printing}>
            {printing ? 'Printing...' : 'Print Bid'}
          </button>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-secondary" onClick={() => setShowExportMenu((o) => !o)}
              disabled={pdfExporting}>
              {pdfExporting ? 'Generating...' : <>Export &#9662;</>}
            </button>
            {showExportMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 790 }}
                  onClick={() => setShowExportMenu(false)} />
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 800,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '4px 0', minWidth: 220,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                }}>
                  {[
                    { label: 'Proposal PDF', action: handleExportPdf },
                    { label: 'QuickBooks CSV', action: handleExportQB },
                    { label: 'Unit Price Schedule CSV', action: handleExportUnitPrices },
                    { label: 'Cost Code Report', action: () => setShowCostCodeReport(true) },
                  ].map((opt) => (
                    <div key={opt.label}
                      onClick={() => { setShowExportMenu(false); opt.action(); }}
                      style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      {opt.label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="btn btn-secondary" onClick={() => setShowCompare(true)}
            title="Compare this estimate against another job (e.g. a duplicated what-if scenario)">
            Compare
          </button>
          {job.status === 'draft' && (
            <button className="btn btn-secondary" onClick={() => updateStatus('submitted')}>Mark Submitted</button>
          )}
          {job.status === 'submitted' && (
            <>
              <button className="btn btn-primary" onClick={() => updateStatus('won')} style={{ background: 'var(--success)' }}>Won</button>
              <button className="btn btn-secondary" onClick={() => updateStatus('lost')}>Lost</button>
            </>
          )}
        </div>
      </div>

      {/* Print header - only visible when printing */}
      <div className="print-only print-header">
        <div className="print-company">
          <h2>{settings?.company_name || 'BidSheet'}</h2>
          {settings?.company_address && <div>{settings.company_address}</div>}
          <div>
            {settings?.company_phone && <span>{settings.company_phone}</span>}
            {settings?.company_phone && settings?.company_email && <span> &middot; </span>}
            {settings?.company_email && <span>{settings.company_email}</span>}
          </div>
        </div>
        <div className="print-job-info">
          <h3>Bid Proposal: {job.name}</h3>
          {job.job_number && <div>Job #: {job.job_number}</div>}
          <div>Client: {job.client || '--'}</div>
          {job.location && <div>Location: {job.location}</div>}
          {job.bid_date && <div>Bid Date: {formatDateLocal(job.bid_date)}</div>}
        </div>
      </div>

      {/* Tab strip */}
      <div className="job-tabs no-print">
        <button className={`job-tab ${activeTab === 'estimate' ? 'job-tab-active' : ''}`}
          onClick={() => setActiveTab('estimate')}>Estimate</button>
        <button className={`job-tab ${activeTab === 'profiles' ? 'job-tab-active' : ''}`}
          onClick={() => setActiveTab('profiles')}>
          Profiles {profileCount > 0 && <span className="job-tab-count">{profileCount}</span>}
        </button>
        <button className={`job-tab ${activeTab === 'quotes' ? 'job-tab-active' : ''}`}
          onClick={() => setActiveTab('quotes')}>Quotes</button>
        {!isChangeOrder && (
          <button className={`job-tab ${activeTab === 'changes' ? 'job-tab-active' : ''}`}
            onClick={() => setActiveTab('changes')}>
            Changes {changeOrders.length > 0 && <span className="job-tab-count">{changeOrders.length}</span>}
          </button>
        )}
      </div>

      {/* Estimate tab */}
      {activeTab === 'estimate' && (<>
      <TakeoffSummaryCard jobId={jobId} onOpenTakeoff={onOpenTakeoff} />
      <div className="no-print flex gap-8" style={{ marginBottom: 8 }}>
        <button className="btn btn-sm btn-secondary" onClick={() => history.undo()}
          disabled={!history.canUndo} title="Undo (Ctrl+Z)">&#8634; Undo</button>
        <button className="btn btn-sm btn-secondary" onClick={() => history.redo()}
          disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">&#8635; Redo</button>
      </div>
      <PriceStateLegend lineItems={lineItems} />
      <BidGrid
        sections={sections}
        lineItems={lineItems}
        summary={summary}
        job={job}
        isLocked={isLocked}
        onAddLineItem={openAddLineItem}
        onEditLineItem={openEditLineItem}
        onDeleteLineItem={deleteLineItem}
        onDeleteSection={deleteSection}
        onEditSection={openSectionSettings}
        onOpenAssemblyPicker={openAssemblyPicker}
        onCommitInlineEdit={commitInlineEdit}
        hasAssemblies={assemblies.length > 0}
        approvedCOTotal={approvedCOTotal}
        revisedTotal={revisedTotal}
        isChangeOrder={isChangeOrder}
      />

      {/* Add Section */}
      <div className="no-print" style={{ padding: '10px 0' }}>
        {showAddSection ? (
          <div className="card mb-24">
            <div className="flex gap-8 items-center">
              <input type="text" className="form-control" value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder='e.g. Sanitary Sewer, Water Main, Mobilization' autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') addSection(); }}
                style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={addSection} disabled={!newSectionName.trim()}>Add</button>
              <button className="btn btn-secondary" onClick={() => setShowAddSection(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-8">
            <button className="btn btn-secondary" onClick={() => withLockCheck(() => setShowAddSection(true))}>+ Add Bid Section</button>
            <button className="btn btn-secondary" onClick={() => withLockCheck(() => setShowBidItemImport(true))}
              title="Scaffold line items from an owner's bid schedule CSV">Import Bid Items…</button>
            <button className="btn btn-secondary" onClick={() => withLockCheck(() => setShowPriceImport(true))}
              title="Load a supplier's quote and reconcile it against this bid's prices">Import job prices…</button>
          </div>
        )}
      </div>
      </>)}

      {/* Profiles tab */}
      {activeTab === 'profiles' && (
        <TrenchProfileList jobId={jobId} onProfileCountChange={setProfileCount} onConvertToBid={(data) => new Promise<void>((resolve) => {
          withLockCheck(async () => { await handleConvertToBid(data); resolve(); }, resolve);
        })} />
      )}

      {/* Quotes tab */}
      {activeTab === 'quotes' && (
        <QuotesTab jobId={jobId} onSendToBid={(selected) => new Promise<void>((resolve, reject) => {
          withLockCheck(async () => {
            try { await handleSendQuotesToBid(selected); resolve(); }
            catch (err) { reject(err); }
          }, resolve);
        })} />
      )}

      {/* Changes tab */}
      {activeTab === 'changes' && !isChangeOrder && (
        <ChangeOrdersTab
          changeOrders={changeOrders}
          coSummaries={coSummaries}
          onOpenJob={onOpenJob}
          onCreateCO={() => withLockCheck(handleCreateCO)}
          onDeleteCO={handleDeleteCO}
        />
      )}

      {/* Line Item Modal */}
      {showLineItemModal && (
        <LineItemModal
          lineForm={lineForm}
          setLineForm={setLineForm}
          editingLineItem={editingLineItem}
          materials={materials}
          crews={crews}
          productionRates={productionRates}
          equipment={equipment}
          onSave={async () => { await saveLineItem(); setLockBypassed(false); }}
          onClose={() => { setShowLineItemModal(false); setLockBypassed(false); }}
        />
      )}

      {/* Section Settings Modal */}
      {editingSection && (
        <SectionSettingsModal
          section={editingSection}
          job={job}
          onSave={saveSectionSettings}
          onClose={() => { setEditingSection(null); setLockBypassed(false); }}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          message={confirmState.msg}
          onYes={confirmState.onYes}
          onNo={() => { const cancel = confirmState.onNo; setConfirmState(null); cancel?.(); }}
          yesLabel={confirmState.yesLabel}
          variant={confirmState.variant}
        />
      )}

      {/* Edit Job Info Modal */}
      {showEditJob && (
        <EditJobModal
          form={editJobForm}
          setForm={setEditJobForm}
          onSave={saveJobInfo}
          onClose={() => setShowEditJob(false)}
        />
      )}

      {/* Compare Jobs Modal */}
      {showCompare && (
        <CompareJobsModal baseJobId={jobId} onClose={() => setShowCompare(false)} />
      )}

      {/* Cost Code Report Modal */}
      {showCostCodeReport && (
        <CostCodeReportModal
          job={job}
          sections={sections}
          lineItems={lineItems}
          onClose={() => setShowCostCodeReport(false)}
        />
      )}

      {/* Bid Item Import Modal */}
      {showBidItemImport && (
        <BidItemImportModal
          jobId={jobId}
          sections={sections}
          onDone={() => { history.record(); loadJob(); }}
          onClose={() => setShowBidItemImport(false)}
        />
      )}

      {/* Per-job price import (reconciliation) */}
      {showPriceImport && (
        <JobPriceImportModal
          jobId={jobId}
          onDone={() => { history.record(); loadJob(); }}
          onClose={() => { setShowPriceImport(false); setLockBypassed(false); }}
        />
      )}

      {/* Assembly Picker Modal */}
      {showAssemblyPicker && (
        <AssemblyPickerModal
          assemblies={assemblies}
          onAdd={addAssemblyToSection}
          onClose={() => setShowAssemblyPicker(false)}
        />
      )}
    </div>
  );
}
