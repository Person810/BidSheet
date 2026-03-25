import React, { useState, useEffect, useCallback } from 'react';

type View = 'list' | 'detail';

export function JobsPage() {
  const [view, setView] = useState<View>('list');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const openJob = (id: number) => {
    setSelectedJobId(id);
    setView('detail');
  };

  const backToList = () => {
    setSelectedJobId(null);
    setView('list');
  };

  return view === 'list' ? (
    <JobList onOpenJob={openJob} />
  ) : (
    <JobDetail jobId={selectedJobId!} onBack={backToList} />
  );
}

// ================================================================
// JOB LIST
// ================================================================

function JobList({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '', jobNumber: '', client: '', location: '', bidDate: '', description: '',
  });

  const loadJobs = useCallback(async () => {
    const j = filter ? await window.api.getJobs(filter) : await window.api.getJobs();
    setJobs(j);
  }, [filter]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const handleCreate = async () => {
    const settings = await window.api.getSettings();
    await window.api.saveJob({
      name: form.name, jobNumber: form.jobNumber || null, client: form.client,
      location: form.location || null, bidDate: form.bidDate || null, startDate: null,
      description: form.description || null, status: 'draft',
      overheadPercent: settings?.default_overhead_percent || 10,
      profitPercent: settings?.default_profit_percent || 10,
      bondPercent: settings?.default_bond_percent || 0,
      taxPercent: settings?.default_tax_percent || 0, notes: null,
    });
    setShowCreate(false);
    setForm({ name: '', jobNumber: '', client: '', location: '', bidDate: '', description: '' });
    loadJobs();
  };

  const handleDelete = async (id: number) => {
    if (confirm('Delete this job and all its bid data? This cannot be undone.')) {
      await window.api.deleteJob(id);
      loadJobs();
    }
  };

  const handleDuplicate = async (id: number) => {
    const result = await window.api.duplicateJob(id);
    if (result?.newJobId) {
      loadJobs();
      onOpenJob(result.newJobId);
    }
  };

  const statusBadge = (status: string) => {
    const classes: Record<string, string> = {
      draft: 'badge-draft', submitted: 'badge-submitted', won: 'badge-won', lost: 'badge-lost',
    };
    return <span className={`badge ${classes[status] || 'badge-draft'}`}>{status}</span>;
  };

  return (
    <div>
      <div className="page-header">
        <h2>Jobs & Bids</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Job</button>
      </div>

      <div className="flex gap-8 mb-24">
        {['', 'draft', 'submitted', 'won', 'lost'].map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}>{f || 'All'}</button>
        ))}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Job Name</th>
            <th>Job #</th>
            <th>Client</th>
            <th>Bid Date</th>
            <th>Status</th>
            <th>Updated</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: 32 }}>
                No jobs found. Click "+ New Job" to create your first bid.
              </td>
            </tr>
          ) : (
            jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <span className="material-name-link" onClick={() => onOpenJob(job.id)}>{job.name}</span>
                </td>
                <td className="text-muted">{job.job_number || '--'}</td>
                <td>{job.client || '--'}</td>
                <td className="text-muted">
                  {job.bid_date ? new Date(job.bid_date).toLocaleDateString() : '--'}
                </td>
                <td>{statusBadge(job.status)}</td>
                <td className="text-muted" style={{ fontSize: 12 }}>
                  {new Date(job.updated_at).toLocaleDateString()}
                </td>
                <td>
                  <div className="flex gap-8">
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDuplicate(job.id)}
                      title="Duplicate this job">Copy</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(job.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New Job</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Job Name</label>
                <input type="text" className="form-control" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Elm Street Sewer Extension" autoFocus />
              </div>
              <div className="form-group">
                <label>Job Number (optional)</label>
                <input type="text" className="form-control" value={form.jobNumber}
                  onChange={(e) => setForm({ ...form, jobNumber: e.target.value })} placeholder="e.g. 2026-042" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Client / GC</label>
                <input type="text" className="form-control" value={form.client}
                  onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="General contractor or owner" />
              </div>
              <div className="form-group">
                <label>Bid Date</label>
                <input type="date" className="form-control" value={form.bidDate}
                  onChange={(e) => setForm({ ...form, bidDate: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Location</label>
              <input type="text" className="form-control" value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, State or address" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input type="text" className="form-control" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name.trim()}>Create Job</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================
// JOB DETAIL (BID EDITOR)
// ================================================================

function JobDetail({ jobId, onBack }: { jobId: number; onBack: () => void }) {
  const [job, setJob] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [lineItems, setLineItems] = useState<Record<number, any[]>>({});
  const [summary, setSummary] = useState<any>(null);
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

  const loadJob = useCallback(async () => {
    const [j, s, mats, cr, pr, eq, set] = await Promise.all([
      window.api.getJob(jobId),
      window.api.getBidSections(jobId),
      window.api.getMaterials(),
      window.api.getCrewTemplates(),
      window.api.getProductionRates(),
      window.api.getEquipment(),
      window.api.getSettings(),
    ]);
    setJob(j);
    setSections(s);
    setMaterials(mats);
    setCrews(cr);
    setProductionRates(pr);
    setEquipment(eq);
    setSettings(set);
    const items: Record<number, any[]> = {};
    for (const sec of s) {
      items[sec.id] = await window.api.getBidLineItems(sec.id);
    }
    setLineItems(items);
    const sum = await window.api.getBidSummary(jobId);
    setSummary(sum);
  }, [jobId]);

  useEffect(() => { loadJob(); }, [loadJob]);

  const updateStatus = async (status: string) => {
    if (!job) return;
    await window.api.saveJob({ ...jobToPayload(job), status });
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

  const deleteSection = async (id: number) => {
    if (confirm('Delete this section and all its line items?')) {
      await window.api.deleteBidSection(id);
      loadJob();
    }
  };

  // ---- Line Items ----
  const openAddLineItem = (sectionId: number) => {
    setEditingSectionId(sectionId);
    setEditingLineItem(null);
    setLineForm(emptyLineForm());
    setShowLineItemModal(true);
  };

  const openEditLineItem = (item: any) => {
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
      equipmentHours: item.equipment_hours,
      equipmentCostPerHour: item.equipment_cost_per_hour,
      subcontractorCost: item.subcontractor_cost,
      notes: item.notes || '',
    });
    setShowLineItemModal(true);
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
      equipmentCostPerHour: lineForm.equipmentCostPerHour,
      equipmentHours: lineForm.equipmentHours,
      subcontractorCost: lineForm.subcontractorCost,
      notes: lineForm.notes || null,
    });
    setShowLineItemModal(false);
    loadJob();
  };

  const deleteLineItem = async (id: number) => {
    if (confirm('Delete this line item?')) {
      await window.api.deleteBidLineItem(id);
      loadJob();
    }
  };

  // ---- Material picker handler ----
  const onMaterialSelect = (materialId: number) => {
    const mat = materials.find((m: any) => m.id === materialId);
    if (mat) {
      setLineForm((prev) => ({
        ...prev,
        materialId: mat.id,
        materialUnitCost: mat.default_unit_cost,
        description: prev.description || mat.name,
        unit: mat.unit,
      }));
    } else {
      setLineForm((prev) => ({ ...prev, materialId: 0 }));
    }
  };

  // ---- Crew picker handler ----
  const onCrewSelect = (crewId: number) => {
    const crew = crews.find((c: any) => c.id === crewId);
    if (crew) {
      const costPerHour = crew.members.reduce(
        (sum: number, m: any) => sum + m.quantity * m.default_hourly_rate * m.burden_multiplier, 0
      );
      setLineForm((prev) => ({
        ...prev,
        crewTemplateId: crew.id,
        laborCostPerHour: costPerHour,
      }));
    } else {
      setLineForm((prev) => ({ ...prev, crewTemplateId: 0 }));
    }
  };

  // ---- Production rate picker handler ----
  const onProductionRateSelect = (rateId: number) => {
    const rate = productionRates.find((r: any) => r.id === rateId);
    if (rate) {
      const hours = rate.rate_per_hour > 0 ? lineForm.quantity / rate.rate_per_hour : 0;
      // Also auto-select the crew for this production rate
      const crew = crews.find((c: any) => c.id === rate.crew_template_id);
      const costPerHour = crew
        ? crew.members.reduce(
            (sum: number, m: any) => sum + m.quantity * m.default_hourly_rate * m.burden_multiplier, 0
          )
        : lineForm.laborCostPerHour;
      setLineForm((prev) => ({
        ...prev,
        productionRateId: rate.id,
        crewTemplateId: rate.crew_template_id,
        laborHours: Math.round(hours * 10) / 10,
        laborCostPerHour: costPerHour,
      }));
    } else {
      setLineForm((prev) => ({ ...prev, productionRateId: 0 }));
    }
  };

  // Recalculate labor hours when quantity changes and a production rate is selected
  const onQuantityChange = (qty: number) => {
    const rate = productionRates.find((r: any) => r.id === lineForm.productionRateId);
    const hours = rate && rate.rate_per_hour > 0 ? qty / rate.rate_per_hour : lineForm.laborHours;
    setLineForm((prev) => ({
      ...prev,
      quantity: qty,
      laborHours: rate ? Math.round(hours * 10) / 10 : prev.laborHours,
    }));
  };

  // ---- Equipment picker handler ----
  const onEquipmentSelect = (equipId: number) => {
    const eq = equipment.find((e: any) => e.id === equipId);
    if (eq) {
      setLineForm((prev) => ({
        ...prev,
        equipmentCostPerHour: eq.hourly_rate,
        equipmentHours: prev.laborHours || prev.equipmentHours, // default to same as labor hours
      }));
    }
  };

  // ---- Print ----
  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const formMatTotal = lineForm.quantity * lineForm.materialUnitCost;
  const formLaborTotal = lineForm.laborHours * lineForm.laborCostPerHour;
  const formEquipTotal = lineForm.equipmentHours * lineForm.equipmentCostPerHour;
  const formTotal = formMatTotal + formLaborTotal + formEquipTotal + lineForm.subcontractorCost;

  if (!job) return <p className="text-muted">Loading job...</p>;

  return (
    <div className="job-detail-page">
      <div className="page-header no-print">
        <div>
          <button className="btn btn-sm btn-secondary mb-16" onClick={onBack}>← Back to Jobs</button>
          <h2>{job.name}</h2>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            {job.client && <span>{job.client}</span>}
            {job.location && <span> · {job.location}</span>}
            {job.bid_date && <span> · Due {new Date(job.bid_date).toLocaleDateString()}</span>}
          </div>
        </div>
        <div className="flex gap-8">
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
          <h2>{settings?.company_name || 'Utility Estimator'}</h2>
          {settings?.company_address && <div>{settings.company_address}</div>}
          <div>
            {settings?.company_phone && <span>{settings.company_phone}</span>}
            {settings?.company_phone && settings?.company_email && <span> · </span>}
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
            <div className="stat-label">Bid Total</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--accent)' }}>
              {formatCurrency(summary.grandTotal)}
            </div>
          </div>
        </div>
      )}

      {/* Sections and Line Items */}
      {sections.map((section) => (
        <div key={section.id} className="card mb-24">
          <div className="flex justify-between items-center mb-16">
            <h3 style={{ fontSize: 15 }}>{section.name}</h3>
            <div className="flex gap-8 no-print">
              <button className="btn btn-sm btn-primary" onClick={() => openAddLineItem(section.id)}>+ Line Item</button>
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
                      <button className="btn btn-sm btn-secondary" onClick={() => deleteLineItem(item.id)}>×</button>
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
          <button className="btn btn-secondary" onClick={() => setShowAddSection(true)}>+ Add Bid Section</button>
        )}
      </div>

      {/* Line Item Modal */}
      {showLineItemModal && (
        <div className="modal-overlay" onClick={() => setShowLineItemModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 700, maxHeight: '90vh' }}>
            <h3>{editingLineItem ? 'Edit Line Item' : 'Add Line Item'}</h3>

            {/* Description */}
            <div className="form-group">
              <label>Description</label>
              <input type="text" className="form-control" value={lineForm.description}
                onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
                placeholder={`e.g. 8" PVC SDR-35 Sanitary Sewer @ 6' depth`} autoFocus />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Quantity</label>
                <input type="number" className="form-control" value={lineForm.quantity}
                  onChange={(e) => onQuantityChange(parseFloat(e.target.value) || 0)} min="0" />
              </div>
              <div className="form-group">
                <label>Unit</label>
                <select className="form-control" value={lineForm.unit}
                  onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value })}>
                  {['LF', 'EA', 'CY', 'SY', 'TON', 'VF', 'LS', 'HR', 'SF', 'GAL'].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Material Section */}
            <div className="line-item-section">
              <label className="section-label">Material Cost</label>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Pick from Catalog (optional)</label>
                  <select className="form-control" value={lineForm.materialId}
                    onChange={(e) => onMaterialSelect(parseInt(e.target.value))}>
                    <option value={0}>-- Manual entry --</option>
                    {materials.map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.unit}) - ${m.default_unit_cost.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Unit Cost ($)</label>
                  <input type="number" className="form-control" value={lineForm.materialUnitCost}
                    onChange={(e) => setLineForm({ ...lineForm, materialUnitCost: parseFloat(e.target.value) || 0 })}
                    step="0.01" min="0" />
                </div>
                <div className="form-group">
                  <label>Total</label>
                  <div className="form-control computed-field">{formatCurrency(formMatTotal)}</div>
                </div>
              </div>
            </div>

            {/* Labor Section */}
            <div className="line-item-section">
              <label className="section-label">Labor Cost</label>
              <div className="form-row">
                <div className="form-group">
                  <label>Production Rate (optional)</label>
                  <select className="form-control" value={lineForm.productionRateId}
                    onChange={(e) => onProductionRateSelect(parseInt(e.target.value))}>
                    <option value={0}>-- Manual entry --</option>
                    {productionRates.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.description} ({r.rate_per_hour} {r.unit}/hr)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Crew</label>
                  <select className="form-control" value={lineForm.crewTemplateId}
                    onChange={(e) => onCrewSelect(parseInt(e.target.value))}>
                    <option value={0}>-- Manual entry --</option>
                    {crews.map((c: any) => {
                      const cost = c.members.reduce(
                        (s: number, m: any) => s + m.quantity * m.default_hourly_rate * m.burden_multiplier, 0
                      );
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name} (${cost.toFixed(2)}/hr)
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Labor Hours</label>
                  <input type="number" className="form-control" value={lineForm.laborHours}
                    onChange={(e) => setLineForm({ ...lineForm, laborHours: parseFloat(e.target.value) || 0 })}
                    step="0.5" min="0" />
                  {lineForm.productionRateId > 0 && (
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                      Auto-calculated from production rate
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Crew Cost / Hour ($)</label>
                  <input type="number" className="form-control" value={lineForm.laborCostPerHour}
                    onChange={(e) => setLineForm({ ...lineForm, laborCostPerHour: parseFloat(e.target.value) || 0 })}
                    step="0.50" min="0" />
                </div>
                <div className="form-group">
                  <label>Total</label>
                  <div className="form-control computed-field">{formatCurrency(formLaborTotal)}</div>
                </div>
              </div>
            </div>

            {/* Equipment Section */}
            <div className="line-item-section">
              <label className="section-label">Equipment Cost</label>
              <div className="form-row">
                <div className="form-group">
                  <label>Pick Equipment (optional)</label>
                  <select className="form-control" defaultValue={0}
                    onChange={(e) => onEquipmentSelect(parseInt(e.target.value))}>
                    <option value={0}>-- Manual entry --</option>
                    {equipment.map((eq: any) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name} (${eq.hourly_rate.toFixed(2)}/hr)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Equipment Hours</label>
                  <input type="number" className="form-control" value={lineForm.equipmentHours}
                    onChange={(e) => setLineForm({ ...lineForm, equipmentHours: parseFloat(e.target.value) || 0 })}
                    step="0.5" min="0" />
                </div>
                <div className="form-group">
                  <label>Cost / Hour ($)</label>
                  <input type="number" className="form-control" value={lineForm.equipmentCostPerHour}
                    onChange={(e) => setLineForm({ ...lineForm, equipmentCostPerHour: parseFloat(e.target.value) || 0 })}
                    step="0.50" min="0" />
                </div>
                <div className="form-group">
                  <label>Total</label>
                  <div className="form-control computed-field">{formatCurrency(formEquipTotal)}</div>
                </div>
              </div>
            </div>

            {/* Sub + Notes */}
            <div className="line-item-section">
              <div className="form-row">
                <div className="form-group">
                  <label>Subcontractor Cost ($)</label>
                  <input type="number" className="form-control" value={lineForm.subcontractorCost}
                    onChange={(e) => setLineForm({ ...lineForm, subcontractorCost: parseFloat(e.target.value) || 0 })}
                    step="1" min="0" />
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <input type="text" className="form-control" value={lineForm.notes}
                    onChange={(e) => setLineForm({ ...lineForm, notes: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Total bar */}
            <div style={{ background: 'var(--bg-tertiary)', padding: 16, borderRadius: 8, marginTop: 8, textAlign: 'right' }}>
              <span className="text-muted" style={{ marginRight: 16 }}>Line Item Total:</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(formTotal)}</span>
              {lineForm.quantity > 0 && (
                <span className="text-muted" style={{ marginLeft: 16 }}>
                  ({formatCurrency(formTotal / lineForm.quantity)} / {lineForm.unit})
                </span>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLineItemModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveLineItem} disabled={!lineForm.description.trim()}>
                {editingLineItem ? 'Save Changes' : 'Add Line Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Helpers ----

function emptyLineForm() {
  return {
    description: '',
    quantity: 0,
    unit: 'LF',
    materialId: 0,
    materialUnitCost: 0,
    crewTemplateId: 0,
    productionRateId: 0,
    laborHours: 0,
    laborCostPerHour: 0,
    equipmentHours: 0,
    equipmentCostPerHour: 0,
    subcontractorCost: 0,
    notes: '',
  };
}

function jobToPayload(job: any) {
  return {
    id: job.id, name: job.name, jobNumber: job.job_number, client: job.client,
    location: job.location, bidDate: job.bid_date, startDate: job.start_date,
    description: job.description, status: job.status, overheadPercent: job.overhead_percent,
    profitPercent: job.profit_percent, bondPercent: job.bond_percent,
    taxPercent: job.tax_percent, notes: job.notes,
  };
}
