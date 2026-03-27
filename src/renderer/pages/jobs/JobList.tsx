import React, { useState, useEffect, useCallback } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface JobListProps {
  onOpenJob: (id: number) => void;
}

export function JobList({ onOpenJob }: JobListProps) {
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

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const handleDelete = async (id: number) => {
    setConfirmState({
      msg: 'Delete this job and all its bid data? This cannot be undone.',
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteJob(id);
        loadJobs();
      },
    });
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

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} />
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
