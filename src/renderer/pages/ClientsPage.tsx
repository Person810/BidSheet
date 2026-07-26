import React, { useState, useEffect, useCallback } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToastStore } from '../stores/toast-store';
import { SortableTh, useSortableRows } from '../components/SortableTable';
import type { ClientRow } from '../../shared/types/ipc';
import { dismissOnEscOnly } from '../components/modalDismiss';

const CLIENT_SORT_ACCESSORS = {
  name: (c: ClientRow) => c.name,
  contact_name: (c: ClientRow) => c.contact_name,
  contact_phone: (c: ClientRow) => c.contact_phone,
  contact_email: (c: ClientRow) => c.contact_email,
  job_count: (c: ClientRow) => c.job_count ?? 0,
};

const EMPTY_FORM = {
  name: '',
  address: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
};

export function ClientsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [isSaving, setIsSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setClients(await window.api.getClients(showRemoved));
    } catch (err: any) {
      addToast(err?.message || 'Failed to load clients.', 'error');
    }
  }, [showRemoved, addToast]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const filtered = clients.filter((c) => {
    const term = searchTerm.toLowerCase();
    return (
      !term ||
      c.name.toLowerCase().includes(term) ||
      (c.contact_name || '').toLowerCase().includes(term) ||
      (c.address || '').toLowerCase().includes(term)
    );
  });
  const { sorted: sortedClients, sort, toggleSort } = useSortableRows(filtered, CLIENT_SORT_ACCESSORS);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (client: ClientRow) => {
    setEditing(client);
    setForm({
      name: client.name,
      address: client.address || '',
      contactName: client.contact_name || '',
      contactPhone: client.contact_phone || '',
      contactEmail: client.contact_email || '',
      notes: client.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await window.api.saveClient({
        id: editing?.id,
        name: form.name.trim(),
        address: form.address.trim() || null,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        notes: form.notes.trim() || null,
      });
      setShowModal(false);
      loadClients();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save client.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (client: ClientRow) => {
    const count = client.job_count ?? 0;
    setConfirmState({
      msg: `Remove ${client.name} from the client list?${count > 0 ? ` Their ${count} job${count !== 1 ? 's' : ''} keep the client name.` : ''}`,
      onYes: async () => {
        setConfirmState(null);
        await window.api.deleteClient(client.id);
        loadClients();
      },
    });
  };

  const handleRestore = async (id: number) => {
    await window.api.restoreClient(id);
    loadClients();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Clients</h2>
        <div className="flex gap-8 items-center">
          <input
            type="text"
            className="form-control"
            placeholder="Search clients..."
            style={{ width: 220 }}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <label className="flex gap-4 items-center" style={{ fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} style={{ width: 14, height: 14 }} />
            Show removed
          </label>
          <button className="btn btn-primary" onClick={openAdd}>
            + Add Client
          </button>
        </div>
      </div>

      <p className="text-muted mb-16">
        Clients autofill on the new-job form — picking one reuses their saved contact details.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <SortableTh label="Name" sortKey="name" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Contact" sortKey="contact_name" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Phone" sortKey="contact_phone" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Email" sortKey="contact_email" sort={sort} onToggle={toggleSort} />
            <SortableTh label="Jobs" sortKey="job_count" sort={sort} onToggle={toggleSort} className="text-right" />
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
                {searchTerm ? (
                  <p style={{ fontSize: 13 }}>No clients match your search.</p>
                ) : (
                  <>
                    <p style={{ fontSize: 16, marginBottom: 12 }}>No clients yet</p>
                    <p style={{ fontSize: 13, marginBottom: 20 }}>
                      Clients are added here automatically when you name one on a job, or add one now.
                    </p>
                    <button className="btn btn-primary" onClick={openAdd}>Add Client</button>
                  </>
                )}
              </td>
            </tr>
          ) : (
            sortedClients.map((client) => (
              <tr key={client.id} style={client.is_active === 0 ? { opacity: 0.5 } : {}}>
                <td>
                  <span className="material-name-link" onClick={() => openEdit(client)}>
                    {client.name}
                  </span>
                  {client.is_active === 0 && (
                    <span className="badge badge-draft" style={{ marginLeft: 8, fontSize: 10 }}>removed</span>
                  )}
                  {client.address && (
                    <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {client.address}
                    </span>
                  )}
                </td>
                <td>{client.contact_name || '--'}</td>
                <td className="text-muted">{client.contact_phone || '--'}</td>
                <td className="text-muted">{client.contact_email || '--'}</td>
                <td className="text-right">{client.job_count ?? 0}</td>
                <td>
                  {client.is_active === 0 ? (
                    <button className="btn btn-sm btn-secondary" onClick={() => handleRestore(client.id)}>
                      Restore
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(client)}>
                      Remove
                    </button>
                  )}
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

      {showModal && (
        <div className="modal-overlay" onClick={dismissOnEscOnly(() => setShowModal(false))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit Client' : 'Add Client'}</h3>
            {editing && (editing.job_count ?? 0) > 0 && (
              <p className="text-muted" style={{ marginBottom: 12, fontSize: 12 }}>
                Renaming updates the client name on all {editing.job_count} of their job{(editing.job_count ?? 0) !== 1 ? 's' : ''}.
              </p>
            )}
            <div className="form-group">
              <label>Name</label>
              <input type="text" className="form-control" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Smith Construction" autoFocus />
            </div>
            <div className="form-group">
              <label>Address</label>
              <input type="text" className="form-control" value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Contact Name</label>
                <input type="text" className="form-control" value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="text" className="form-control" value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="text" className="form-control" value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input type="text" className="form-control" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Net-30, prefers email" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}
                disabled={!form.name.trim() || isSaving}>
                {isSaving ? 'Saving...' : editing ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
