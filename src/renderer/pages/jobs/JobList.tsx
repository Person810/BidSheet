import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SortableTh, useSortableRows } from '../../components/SortableTable';
import { useToastStore } from '../../stores/toast-store';
import { useCloudStore, initCloudStore, CloudJobSync } from '../../stores/cloud-store';
import { useJobNumberWarning } from '../../hooks/useJobNumberWarning';
import { ClientField, commitClientDetails, type ClientDetailsDraft } from '../../components/ClientField';
import { SavedClientPicker } from '../../components/clients/SavedClientPicker';
import { formatDateLocal, statusBadge } from './helpers';

const JOB_SORT_ACCESSORS = {
  name: (j: any) => j.name,
  job_number: (j: any) => j.job_number,
  client: (j: any) => j.client,
  bid_date: (j: any) => j.bid_date,
  status: (j: any) => j.status,
  updated_at: (j: any) => j.updated_at,
};

const EMPTY_JOB_FORM = {
  name: '', jobNumber: '', client: '', location: '', bidDate: '', description: '',
};

interface JobListProps {
  onOpenJob: (id: number) => void;
}

export function JobList({ onOpenJob }: JobListProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobCOs, setJobCOs] = useState<Record<number, any[]>>({});
  const [filter, setFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_JOB_FORM });
  // The auto-suggested number currently sitting in the field (so the hint
  // disappears as soon as the user types their own).
  const [suggestedNumber, setSuggestedNumber] = useState<string | null>(null);
  const numberWarning = useJobNumberWarning(showCreate ? form.jobNumber : '');

  const openCreate = async () => {
    setShowCreate(true);
    try {
      const res = await window.api.getNextJobNumber();
      if (res?.enabled && res.suggestion) {
        const suggestion = res.suggestion;
        // Only pre-fill an empty field — a number typed while the suggestion
        // was still in flight wins.
        setForm((f) => {
          if (f.jobNumber) return f;
          setSuggestedNumber(suggestion);
          return { ...f, jobNumber: suggestion };
        });
      }
    } catch {
      // Suggestion is a convenience — the modal works without one.
    }
  };

  // Closing the modal abandons the whole draft (#111). A left-over client
  // details draft is the dangerous part: reopening New Job would show the
  // abandoned client's address/contact and, on save, write them onto
  // whatever client name the next job uses.
  const closeCreate = () => {
    setShowCreate(false);
    setForm({ ...EMPTY_JOB_FORM });
    setSuggestedNumber(null);
  };

  // Staleness guard: switching the status filter quickly can leave a slow
  // earlier load finishing after a newer one — only the latest call may
  // commit its list, or the newer filter's results get overwritten.
  const loadGeneration = useRef(0);
  const loadJobs = useCallback(async () => {
    const gen = ++loadGeneration.current;
    try {
      const j = filter ? await window.api.getJobs(filter) : await window.api.getJobs();
      if (gen !== loadGeneration.current) return;
      setJobs(j);
      const coMap: Record<number, any[]> = {};
      for (const job of j) {
        const cos = await window.api.getChangeOrders(job.id);
        if (cos.length > 0) coMap[job.id] = cos;
      }
      if (gen !== loadGeneration.current) return;
      setJobCOs(coMap);
    } catch (err: any) {
      if (gen !== loadGeneration.current) return;
      addToast(err?.message || 'Failed to load jobs.', 'error');
    }
  }, [filter, addToast]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const handleCreate = async () => {
    const settings = await window.api.getSettings();
    const result = await window.api.saveJob({
      name: form.name, jobNumber: form.jobNumber || null, client: form.client,
      location: form.location || null, bidDate: form.bidDate || null, startDate: null,
      description: form.description || null, status: 'draft',
      overheadPercent: settings?.default_overhead_percent || 10,
      profitPercent: settings?.default_profit_percent || 10,
      bondPercent: settings?.default_bond_percent || 0,
      taxPercent: settings?.default_tax_percent || 0, notes: null,
    });
    closeCreate();
    if (result?.lastInsertRowid) {
      onOpenJob(Number(result.lastInsertRowid));
    } else {
      loadJobs();
    }
  };

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);
  const { sorted: sortedJobs, sort, toggleSort } = useSortableRows(jobs, JOB_SORT_ACCESSORS);

  // ---- Cloud sync ----
  const { auth, sync } = useCloudStore();
  const cloudReady = auth?.aal === 'aal2';
  const [conflictJobId, setConflictJobId] = useState<number | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);

  useEffect(() => { initCloudStore(); }, []);

  const syncByJobId = new Map<number, CloudJobSync>((sync?.jobs || []).map((j) => [j.jobId, j]));

  const cloudAction = async (fn: () => Promise<any>, reloadJobs = false) => {
    setCloudBusy(true);
    try {
      await fn();
      if (reloadJobs) await loadJobs();
    } catch (err: any) {
      addToast(err?.message || 'Cloud sync error.', 'error');
    } finally {
      setCloudBusy(false);
    }
  };

  const cloudCell = (jobId: number) => {
    const s = syncByJobId.get(jobId);
    if (!s || !s.enabled) {
      return (
        <button className="btn btn-sm btn-secondary" disabled={cloudBusy} title="Back this job up to the cloud"
          onClick={(e) => { e.stopPropagation(); cloudAction(() => window.api.cloudEnableJob(jobId)); }}>
          Sync
        </button>
      );
    }
    if (s.status === 'conflict') {
      return (
        <button className="btn btn-sm btn-primary" disabled={cloudBusy}
          onClick={(e) => { e.stopPropagation(); setConflictJobId(jobId); }}>
          Resolve…
        </button>
      );
    }
    if (s.status === 'error') {
      return (
        <span className="badge badge-lost" style={{ cursor: 'pointer' }}
          title={`${s.error || 'Sync failed.'} Click to retry.`}
          onClick={(e) => { e.stopPropagation(); cloudAction(() => window.api.cloudPushJob(jobId)); }}>
          Sync error
        </span>
      );
    }
    return (
      <span className={`badge ${s.status === 'synced' ? 'badge-won' : 'badge-submitted'}`}
        style={{ cursor: 'pointer' }}
        title={`${s.status === 'synced' ? 'Backed up to the cloud' : 'Waiting to sync'}${s.lastSyncedAt ? ` (last sync ${s.lastSyncedAt})` : ''}. Click to turn sync off for this job.`}
        onClick={(e) => {
          e.stopPropagation();
          setConfirmState({
            msg: 'Turn off cloud sync for this job? The cloud copy stays for now; this computer just stops syncing it.',
            onYes: () => { setConfirmState(null); cloudAction(() => window.api.cloudDisableJob(jobId)); },
          });
        }}>
        {s.status === 'synced' ? 'Synced' : 'Pending'}
      </span>
    );
  };

  const columnCount = cloudReady ? 8 : 7;

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

  const [dupState, setDupState] = useState<{ jobId: number; name: string; bidDate: string; jobNumber: string } | null>(null);
  const [dupSuggested, setDupSuggested] = useState<string | null>(null);
  const dupNumberWarning = useJobNumberWarning(dupState?.jobNumber || '');

  const startDuplicate = async (job: any) => {
    // Copying the source's number would mint a guaranteed duplicate, so
    // suggest the next number instead when auto-numbering is on.
    let jobNumber = job.job_number || '';
    let suggested: string | null = null;
    try {
      const res = await window.api.getNextJobNumber();
      if (res?.enabled && res.suggestion) {
        jobNumber = res.suggestion;
        suggested = res.suggestion;
      }
    } catch {
      // Fall back to the source's number; the field stays editable.
    }
    setDupSuggested(suggested);
    setDupState({
      jobId: job.id,
      name: job.name + ' (Copy)',
      bidDate: new Date().toISOString().slice(0, 10),
      jobNumber,
    });
  };

  const handleDuplicate = async () => {
    if (!dupState) return;
    const result = await window.api.duplicateJob(
      dupState.jobId, dupState.name, dupState.bidDate || null, dupState.jobNumber.trim() || null
    );
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
        <button className="btn btn-primary" onClick={openCreate}>+ New Job</button>
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
            <SortableTh label="Job Name" sortKey="name" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Job #" sortKey="job_number" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Client" sortKey="client" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Bid Date" sortKey="bid_date" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Status" sortKey="status" sort={sort} onToggle={toggleSort} />
            {cloudReady && <th>Cloud</th>}
            <SortableTh label="Updated" sortKey="updated_at" sort={sort} onToggle={toggleSort} />
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="text-muted" style={{ textAlign: 'center', padding: 32 }}>
                No jobs found. Click "+ New Job" to create your first bid.
              </td>
            </tr>
          ) : (
            sortedJobs.map((job) => (
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
                  {cloudReady && <td>{cloudCell(job.id)}</td>}
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
                    {cloudReady && <td>{cloudCell(co.id)}</td>}
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

      {cloudReady && (sync?.cloudOnly.length || 0) > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>In the Cloud, Not on This Computer</h3>
          <p className="text-muted mb-16">
            Jobs synced from another computer on your account. Pull one to work on it here.
          </p>
          <table className="data-table">
            <tbody>
              {sync!.cloudOnly.map((cj) => (
                <tr key={cj.cloudId}>
                  <td>{cj.name}</td>
                  <td>{statusBadge(cj.status || 'draft')}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    {cj.updatedAt ? `updated ${cj.updatedAt}` : ''}
                  </td>
                  <td style={{ width: 120 }}>
                    <button className="btn btn-sm btn-primary" disabled={cloudBusy}
                      onClick={() => cloudAction(async () => {
                        await window.api.cloudPullJob(cj.cloudId);
                        addToast(`Pulled "${cj.name}" from the cloud.`, 'success');
                        await window.api.cloudSyncNow().catch(() => {});
                      }, true)}>
                      Pull
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {conflictJobId !== null && (
        <div className="modal-overlay" onClick={() => setConflictJobId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Sync Conflict</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              This job changed both on this computer and in the cloud since the last sync.
              Pick which copy to keep. The other one is overwritten.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConflictJobId(null)}>Cancel</button>
              <button className="btn btn-secondary" disabled={cloudBusy}
                onClick={() => {
                  const id = conflictJobId;
                  setConflictJobId(null);
                  cloudAction(() => window.api.cloudResolveConflict(id, 'cloud'), true);
                }}>
                Use Cloud Copy
              </button>
              <button className="btn btn-primary" disabled={cloudBusy}
                onClick={() => {
                  const id = conflictJobId;
                  setConflictJobId(null);
                  cloudAction(() => window.api.cloudResolveConflict(id, 'local'));
                }}>
                Keep This Computer's
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="form-row">
              <div className="form-group">
                <label>Job Number (optional)</label>
                <input type="text" className="form-control" value={dupState.jobNumber}
                  onChange={(e) => setDupState({ ...dupState, jobNumber: e.target.value })} />
                {dupNumberWarning ? (
                  <div className="text-warning" style={{ fontSize: 12, marginTop: 4 }}>{dupNumberWarning}</div>
                ) : dupSuggested && dupState.jobNumber === dupSuggested ? (
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Suggested next number — edit freely
                  </div>
                ) : null}
              </div>
              <div className="form-group">
                <label>Bid Date</label>
                <input type="date" className="form-control" value={dupState.bidDate}
                  onChange={(e) => setDupState({ ...dupState, bidDate: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDupState(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleDuplicate} disabled={!dupState.name.trim()}>Create Copy</button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay">
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
                {numberWarning ? (
                  <div className="text-warning" style={{ fontSize: 12, marginTop: 4 }}>{numberWarning}</div>
                ) : suggestedNumber && form.jobNumber === suggestedNumber ? (
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Suggested next number — edit freely
                  </div>
                ) : null}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Client / GC</label>
                <SavedClientPicker
                  value={form.client}
                  onChange={(name) => setForm({ ...form, client: name })}
                  onSelectClient={(client) => {
                    setForm((f) => ({
                      ...f,
                      client: client.name,
                    }));
                  }}
                />
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
              <button className="btn btn-secondary" onClick={closeCreate}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name.trim()}>Create Job</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
