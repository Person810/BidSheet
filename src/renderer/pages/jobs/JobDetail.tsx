import React, { useState, useEffect, useCallback } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { LineItemModal } from './LineItemModal';
import { AssemblyPickerModal } from './AssemblyPickerModal';
import { emptyLineForm, jobToPayload, formatCurrency } from './helpers';
import { TrenchProfileList, type ConvertToBidProfile } from './TrenchProfileList';
import { useToastStore } from '../../stores/toast-store';

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
  const [showAddSection, setShowAddSection] = useState(false);
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

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void; yesLabel?: string; variant?: 'danger' | 'neutral' } | null>(null);
  const [showEditJob, setShowEditJob] = useState(false);
  const [editJobForm, setEditJobForm] = useState({ name: '', jobNumber: '', client: '', location: '', bidDate: '', description: '' });
  const [lockBypassed, setLockBypassed] = useState(false);

  // Derived: bid is effectively locked when job is won or lost, bid_locked=1, and user hasn't bypassed this session
  const isLocked = (job?.status === 'won' || job?.status === 'lost') && job?.bid_locked === 1 && !lockBypassed;

  // Gate any destructive/edit action behind a soft lock warning
  const withLockCheck = (action: () => void) => {
    if (isLocked) {
      setConfirmState({
        msg: 'This bid is locked. Edit anyway?',
        yesLabel: 'Edit Anyway',
        variant: 'neutral',
        onYes: () => { setConfirmState(null); setLockBypassed(true); action(); },
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
        setParentJob(p);
      } else {
        setParentJob(null);
      }
    } catch (err: any) {
      addToast(err?.message || 'Failed to load job data.', 'error');
    }
  }, [jobId, addToast]);

  useEffect(() => {
    loadJob();
    setLockBypassed(false);
  }, [loadJob]);

  const updateStatus = async (status: string) => {
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
    });
    setShowEditJob(true);
  };

  const saveJobInfo = async () => {
    if (!job || !editJobForm.name.trim()) return;
    await window.api.saveJob({
      ...jobToPayload(job),
      name: editJobForm.name.trim(),
      jobNumber: editJobForm.jobNumber || null,
      client: editJobForm.client || null,
      location: editJobForm.location || null,
      bidDate: editJobForm.bidDate || null,
      description: editJobForm.description || null,
    });
    setShowEditJob(false);
    loadJob();
  };

  // ---- Sections ----
  const addSection = async () => {
    if (!newSectionName.trim()) return;
    await window.api.saveBidSection({ jobId, name: newSectionName, sortOrder: sections.length });
    setNewSectionName('');
    setShowAddSection(false);
    loadJob();
  };

  const deleteSection = (id: number) => {
    withLockCheck(() => {
      setConfirmState({
        msg: 'Delete this section and all its line items?',
        onYes: async () => {
          setConfirmState(null);
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
      });
      setShowLineItemModal(true);
    });
  };

  const saveLineItem = async () => {
    const sectionItems = lineItems[editingSectionId!] || [];
    await window.api.saveBidLineItem({
      id: editingLineItem?.id,
      sectionId: editingSectionId,
      jobId,
      description: lineForm.description,
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
    });
    setShowLineItemModal(false);
    loadJob();
  };

  const deleteLineItem = (id: number) => {
    withLockCheck(() => {
      setConfirmState({
        msg: 'Delete this line item?',
        onYes: async () => {
          setConfirmState(null);
          setLockBypassed(false);
          await window.api.deleteBidLineItem(id);
          loadJob();
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
    const sectionItems = lineItems[assemblySectionId] || [];
    let sortOrder = sectionItems.length;

    for (const item of assembly.items) {
      await window.api.saveBidLineItem({
        sectionId: assemblySectionId,
        jobId,
        description: item.material_name,
        quantity: item.quantity * qty,
        unit: item.material_unit,
        sortOrder: sortOrder++,
        materialId: item.material_id,
        materialUnitCost: item.material_unit_cost,
        crewTemplateId: null,
        productionRateId: null,
        laborHours: 0,
        laborCostPerHour: 0,
        equipmentCostPerHour: 0,
        equipmentHours: 0,
        subcontractorCost: 0,
        notes: `From assembly: ${assembly.name}`,
      });
    }

    setShowAssemblyPicker(false);
    loadJob();
  };

  // ---- Convert trench profiles to bid sections ----
  const handleConvertToBid = async (profileData: ConvertToBidProfile[]) => {
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
    const sectionId = Number(sectionResult.lastInsertRowid);
    let sortOrder = 0;

    const saveItem = (opts: { description: string; quantity: number; unit: string; materialId: number | null; materialUnitCost: number; notes: string }) =>
      window.api.saveBidLineItem({
        sectionId, jobId, sortOrder: sortOrder++,
        description: opts.description, quantity: opts.quantity, unit: opts.unit,
        materialId: opts.materialId, materialUnitCost: opts.materialUnitCost,
        crewTemplateId: null, productionRateId: null,
        laborHours: 0, laborCostPerHour: 0,
        equipmentId: null, equipmentCostPerHour: 0, equipmentHours: 0,
        subcontractorCost: 0, notes: opts.notes,
      });

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

    // Bedding line items (one per material type)
    for (const entry of beddingByKey.values()) {
      const mat = entry.materialId ? materials.find((m: any) => m.id === entry.materialId) : null;
      const unitMismatch = mat && mat.unit !== 'CY' && mat.unit !== 'CYD';
      await saveItem({
        description: entry.name, quantity: entry.qty, unit: 'CY',
        materialId: entry.materialId, materialUnitCost: 0,
        notes: unitMismatch ? `${profileNote} | Catalog unit is ${mat.unit} -- adjust pricing manually` : profileNote,
      });
    }

    // Backfill line items (one per material type)
    for (const entry of backfillByKey.values()) {
      const mat = entry.materialId ? materials.find((m: any) => m.id === entry.materialId) : null;
      const unitMismatch = mat && mat.unit !== 'CY' && mat.unit !== 'CYD';
      await saveItem({
        description: entry.name, quantity: entry.qty, unit: 'CY',
        materialId: entry.materialId, materialUnitCost: 0,
        notes: unitMismatch ? `${profileNote} | Catalog unit is ${mat.unit} -- adjust pricing manually` : profileNote,
      });
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

  // Revised total: original bid + approved (won) COs
  const approvedCOTotal = changeOrders
    .filter((co) => co.status === 'won')
    .reduce((sum, co) => sum + (coSummaries[co.id]?.grandTotal || 0), 0);
  const revisedTotal = summary ? summary.grandTotal + approvedCOTotal : 0;

  // ---- Print ----
  const handlePrint = () => {
    window.print();
  };

  const statusBadge = (status: string) => {
    const classes: Record<string, string> = {
      draft: 'badge-draft', submitted: 'badge-submitted', won: 'badge-won', lost: 'badge-lost',
    };
    return <span className={`badge ${classes[status] || 'badge-draft'}`}>{status}</span>;
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
            <button className="btn btn-sm btn-secondary" onClick={openEditJob} style={{ fontSize: 12 }}>Edit</button>
            {onOpenTakeoff && (
              <button className="btn btn-sm btn-secondary" onClick={onOpenTakeoff} style={{ fontSize: 12 }}>Plan Takeoff</button>
            )}
          </div>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            {job.client && <span>{job.client}</span>}
            {job.location && <span> &middot; {job.location}</span>}
            {job.bid_date && <span> &middot; Due {new Date(job.bid_date).toLocaleDateString()}</span>}
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
          <button className="btn btn-secondary" onClick={handlePrint}>Print Bid</button>
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
          {job.bid_date && <div>Bid Date: {new Date(job.bid_date).toLocaleDateString()}</div>}
        </div>
      </div>

      {/* Bid Summary */}
      {summary && (
        <div className="card-grid mb-24">
          <div className="card">
            <div className="stat-label">Material</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(summary.material_total)}</div>
          </div>
          <div className="card">
            <div className="stat-label">Labor</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(summary.labor_total)}</div>
          </div>
          <div className="card">
            <div className="stat-label">Equipment</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(summary.equipment_total)}</div>
          </div>
          <div className="card">
            <div className="stat-label">Direct Cost</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(summary.direct_cost_total)}</div>
          </div>
          <div className="card">
            <div className="stat-label">OH + Profit + Bond + Tax</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              {formatCurrency(summary.overhead + summary.profit + summary.bond + summary.tax)}
            </div>
          </div>
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <div className="stat-label">{isChangeOrder ? 'CO Total' : 'Bid Total'}</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--accent)' }}>
              {formatCurrency(summary.grandTotal)}
            </div>
          </div>
          {!isChangeOrder && approvedCOTotal > 0 && (
            <div className="card" style={{ borderColor: 'var(--success)' }}>
              <div className="stat-label">Revised Total</div>
              <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>
                {formatCurrency(revisedTotal)}
              </div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                Original + Approved COs
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sections and Line Items */}
      {sections.map((section) => (
        <div key={section.id} className="card mb-24">
          <div className="flex justify-between items-center mb-16">
            <h3 style={{ fontSize: 15 }}>{section.name}</h3>
            <div className="flex gap-8 no-print">
              <button className="btn btn-sm btn-primary" onClick={() => openAddLineItem(section.id)}>+ Line Item</button>
              {assemblies.length > 0 && (
                <button className="btn btn-sm btn-secondary" onClick={() => openAssemblyPicker(section.id)}>+ Assembly</button>
              )}
              <button className="btn btn-sm btn-secondary" onClick={() => deleteSection(section.id)}>Remove Section</button>
            </div>
          </div>
          {(lineItems[section.id] || []).length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>No line items. Click "+ Line Item" to add one.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="text-right">Qty</th>
                  <th>Unit</th>
                  <th className="text-right">Material</th>
                  <th className="text-right">Labor</th>
                  <th className="text-right">Equipment</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Unit Cost</th>
                  <th className="no-print" style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {(lineItems[section.id] || []).map((item: any) => (
                  <tr key={item.id}>
                    <td>
                      <span className="material-name-link no-print" onClick={() => openEditLineItem(item)}>
                        {item.description}
                      </span>
                      <span className="print-only">{item.description}</span>
                    </td>
                    <td className="text-right">{item.quantity}</td>
                    <td>{item.unit}</td>
                    <td className="text-right">{formatCurrency(item.material_total)}</td>
                    <td className="text-right">{formatCurrency(item.labor_total)}</td>
                    <td className="text-right">{formatCurrency(item.equipment_total)}</td>
                    <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(item.total_cost)}</td>
                    <td className="text-right text-muted">
                      {item.quantity > 0 ? formatCurrency(item.unit_cost) : '--'}
                    </td>
                    <td className="no-print">
                      <button className="btn btn-sm btn-secondary" onClick={() => deleteLineItem(item.id)}>&#215;</button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} className="text-right" style={{ fontWeight: 600 }}>Section Total</td>
                  <td className="text-right" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                    {formatCurrency((lineItems[section.id] || []).reduce((s: number, i: any) => s + i.total_cost, 0))}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      ))}

      {/* Trench Profiles */}
      <TrenchProfileList jobId={jobId} onConvertToBid={(data) => new Promise<void>((resolve) => {
        withLockCheck(async () => { await handleConvertToBid(data); resolve(); });
      })} />

      {/* Change Orders (parent jobs only) */}
      {!isChangeOrder && (
        <div className="card mb-24">
          <div className="flex justify-between items-center mb-16">
            <h3 style={{ fontSize: 15 }}>Change Orders</h3>
            <button className="btn btn-sm btn-primary no-print" onClick={() => withLockCheck(handleCreateCO)}>+ Change Order</button>
          </div>

          {changeOrders.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>No change orders. Click "+ Change Order" to create one.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>CO #</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th className="text-right">Direct Cost</th>
                  <th className="text-right">Total</th>
                  <th className="no-print" style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {changeOrders.map((co) => {
                  const coSum = coSummaries[co.id];
                  return (
                    <tr key={co.id}>
                      <td>
                        <span className="badge badge-submitted" style={{ fontSize: 11 }}>#{co.change_order_number}</span>
                      </td>
                      <td>
                        <span className="material-name-link no-print" onClick={() => onOpenJob(co.id)}>{co.name}</span>
                        <span className="print-only">{co.name}</span>
                      </td>
                      <td>{statusBadge(co.status)}</td>
                      <td className="text-right">{coSum ? formatCurrency(coSum.direct_cost_total) : '--'}</td>
                      <td className="text-right" style={{ fontWeight: 600 }}>{coSum ? formatCurrency(coSum.grandTotal) : '--'}</td>
                      <td className="no-print">
                        <div className="flex gap-8">
                          <button className="btn btn-sm btn-secondary" onClick={() => onOpenJob(co.id)}>Open</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => withLockCheck(() => {
                            setConfirmState({
                              msg: `Delete CO #${co.change_order_number} and all its bid data? This cannot be undone.`,
                              onYes: async () => {
                                setConfirmState(null);
                                await window.api.deleteJob(co.id);
                                loadJob();
                              },
                            });
                          })}>&times;</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={4} className="text-right" style={{ fontWeight: 600 }}>COs Total</td>
                  <td className="text-right" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                    {formatCurrency(changeOrders.reduce((s, co) => s + (coSummaries[co.id]?.grandTotal || 0), 0))}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Print summary footer */}
      {summary && (
        <div className="print-only print-summary-table">
          <table className="data-table">
            <tbody>
              <tr><td>Direct Cost (Material + Labor + Equipment + Sub)</td><td className="text-right">{formatCurrency(summary.direct_cost_total)}</td></tr>
              <tr><td>Overhead ({job.overhead_percent}%)</td><td className="text-right">{formatCurrency(summary.overhead)}</td></tr>
              <tr><td>Profit ({job.profit_percent}%)</td><td className="text-right">{formatCurrency(summary.profit)}</td></tr>
              {summary.bond > 0 && <tr><td>Bond ({job.bond_percent}%)</td><td className="text-right">{formatCurrency(summary.bond)}</td></tr>}
              {summary.tax > 0 && <tr><td>Sales Tax ({job.tax_percent}%)</td><td className="text-right">{formatCurrency(summary.tax)}</td></tr>}
              <tr style={{ fontWeight: 700, fontSize: 16 }}>
                <td>BID TOTAL</td><td className="text-right">{formatCurrency(summary.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Add Section */}
      <div className="no-print">
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
          <button className="btn btn-secondary" onClick={() => withLockCheck(() => setShowAddSection(true))}>+ Add Bid Section</button>
        )}
      </div>

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

      {confirmState && (
        <ConfirmDialog
          message={confirmState.msg}
          onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)}
          yesLabel={confirmState.yesLabel}
          variant={confirmState.variant}
        />
      )}

      {/* Edit Job Info Modal */}
      {showEditJob && (
        <div className="modal-overlay" onClick={() => setShowEditJob(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Job</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Job Name</label>
                <input type="text" className="form-control" value={editJobForm.name}
                  onChange={(e) => setEditJobForm({ ...editJobForm, name: e.target.value })}
                  autoFocus />
              </div>
              <div className="form-group">
                <label>Job Number</label>
                <input type="text" className="form-control" value={editJobForm.jobNumber}
                  onChange={(e) => setEditJobForm({ ...editJobForm, jobNumber: e.target.value })}
                  placeholder="optional" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Client / GC</label>
                <input type="text" className="form-control" value={editJobForm.client}
                  onChange={(e) => setEditJobForm({ ...editJobForm, client: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Bid Date</label>
                <input type="date" className="form-control" value={editJobForm.bidDate}
                  onChange={(e) => setEditJobForm({ ...editJobForm, bidDate: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Location</label>
              <input type="text" className="form-control" value={editJobForm.location}
                onChange={(e) => setEditJobForm({ ...editJobForm, location: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input type="text" className="form-control" value={editJobForm.description}
                onChange={(e) => setEditJobForm({ ...editJobForm, description: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowEditJob(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveJobInfo} disabled={!editJobForm.name.trim()}>Save</button>
            </div>
          </div>
        </div>
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
