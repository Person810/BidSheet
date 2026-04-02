import React, { useState, useEffect, useCallback } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toast-store';
import { formatDateLocal, statusBadge } from './helpers';

interface JobListProps {
  onOpenJob: (id: number) => void;
}

export function JobList({ onOpenJob }: JobListProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobCOs, setJobCOs] = useState<Record<number, any[]>>({});
  const [filter, setFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '', jobNumber: '', client: '', location: '', bidDate: '', description: '',
  });

  const loadJobs = useCallback(async () => {
    try {
      const j = filter ? await window.api.getJobs(filter) : await window.api.getJobs();
      setJobs(j);
      const coMap: Record<number, any[]> = {};
      for (const job of j) {
        const cos = await window.api.getChangeOrders(job.id);
        if (cos.length > 0) coMap[job.id] = cos;
      }
      setJobCOs(coMap);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load jobs.', 'error');
    }
  }, [filter, addToast]);

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

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const handleDelete = async (id: number) => {
    const coCount = jobCOs[id]?.length || 0;
    const coWarning = coCount > 0 ? ` This will also delete ${coCount} change order${coCount !== 1 ? 's' : ''}.` : '';
    setConfirmState({
      msg: `Delete this job and all its bid data?${coWarning} This cannot be undone.`,
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteJob(id);
        loadJobs();
      },
    });
  };

  const [dupState, setDupState] = useState<{ jobId: number; name: string; bidDate: string } | null>(null);

  const startDuplicate = (job: any) => {
    setDupState({
      jobId: job.id,
      name: job.name + ' (Copy)',
      bidDate: new Date().toISOString().slice(0, 10),
    });
  };

  const handleDuplicate = async () => {
    if (!dupState) return;
    const result = await window.api.duplicateJob(dupState.jobId, dupState.name, dupState.bidDate || null);
    setDupState(null);
    if (result?.newJobId) {
      loadJobs();
      onOpenJob(result.newJobId);
    }
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
              <React.Fragment key={job.id}>
                <tr className="clickable-row" onClick={() => onOpenJob(job.id)}>
                  <td>
                    <span className="material-name-link">{job.name}</span>
                    {(jobCOs[job.id]?.length || 0) > 0 && (
                      <span className="text-muted" style={{ fontSize: 11, marginLeft: 8 }}>
                        {jobCOs[job.id].length} CO{jobCOs[job.id].length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{job.job_number || '--'}</td>
                  <td>{job.client || '--'}</td>
                  <td className="text-muted">
                    {job.bid_date ? formatDateLocal(job.bid_date) : '--'}
                  </td>
                  <td>{statusBadge(job.status)}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    {new Date(job.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="flex gap-8">
                      <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); startDuplicate(job); }}
                        title="Duplicate this job as a template">Copy</button>
                      <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}>Delete</button>
                    </div>
                  </td>
                </tr>
                {(jobCOs[job.id] || []).map((co) => (
                  <tr key={`co-${co.id}`} className="co-sub-row clickable-row" onClick={() => onOpenJob(co.id)}>
                    <td className="co-sub-row-name">
                      <span className="badge badge-submitted" style={{ fontSize: 10, padding: '1px 6px', marginRight: 6 }}>
                        #{co.change_order_number}
                      </span>
                      {co.name}
                    </td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td>{statusBadge(co.status)}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>
                      {new Date(co.updated_at).toLocaleDateString()}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onOpenJob(co.id); }}>Open</button>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} />
      )}

      {dupState && (
        <div className="modal-overlay" onClick={() => setDupState(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Copy Job as Template</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>All sections, line items, markups, and trench profiles will be copied. The original job stays untouched.</p>
            <div className="form-group">
              <label>New Job Name</label>
              <input type="text" className="form-control" value={dupState.name}
                onChange={(e) => setDupState({ ...dupState, name: e.target.value })} autoFocus />
            </div>
            <div className="form-group">
              <label>Bid Date</label>
              <input type="date" className="form-control" value={dupState.bidDate}
                onChange={(e) => setDupState({ ...dupState, bidDate: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDupState(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleDuplicate} disabled={!dupState.name.trim()}>Create Copy</button>
            </div>
          </div>
        </div>
      )}

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
