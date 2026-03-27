import React, { useState, useEffect, useCallback } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { LineItemModal } from './LineItemModal';
import { AssemblyPickerModal } from './AssemblyPickerModal';
import { emptyLineForm, jobToPayload, formatCurrency } from './helpers';

interface JobDetailProps {
  jobId: number;
  onBack: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
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
  const [assemblies, setAssemblies] = useState<any[]>([]);

  // Assembly picker state
  const [showAssemblyPicker, setShowAssemblyPicker] = useState(false);
  const [assemblySectionId, setAssemblySectionId] = useState<number | null>(null);

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const loadJob = useCallback(async () => {
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
    setConfirmState({
      msg: 'Delete this section and all its line items?',
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteBidSection(id);
        loadJob();
      },
    });
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
    setConfirmState({
      msg: 'Delete this line item?',
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteBidLineItem(id);
        loadJob();
      },
    });
  };

  // ---- Assembly picker ----
  const openAssemblyPicker = (sectionId: number) => {
    setAssemblySectionId(sectionId);
    setShowAssemblyPicker(true);
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

  // ---- Print ----
  const handlePrint = () => {
    window.print();
  };

  if (!job) return <p className="text-muted">Loading job...</p>;

  return (
    <div className="job-detail-page">
      <div className="page-header no-print">
        <div>
          <button className="btn btn-sm btn-secondary mb-16" onClick={onBack}>&#8592; Back to Jobs</button>
          <h2>{job.name}</h2>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            {job.client && <span>{job.client}</span>}
            {job.location && <span> &middot; {job.location}</span>}
            {job.bid_date && <span> &middot; Due {new Date(job.bid_date).toLocaleDateString()}</span>}
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
        <LineItemModal
          lineForm={lineForm}
          setLineForm={setLineForm}
          editingLineItem={editingLineItem}
          materials={materials}
          crews={crews}
          productionRates={productionRates}
          equipment={equipment}
          onSave={saveLineItem}
          onClose={() => setShowLineItemModal(false)}
        />
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} />
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
