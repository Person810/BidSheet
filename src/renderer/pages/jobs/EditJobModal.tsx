import React from 'react';
import { useJobNumberWarning } from '../../hooks/useJobNumberWarning';
import { useLocaleStore } from '../../stores/locale-store';
import { SavedClientPicker } from '../../components/clients/SavedClientPicker';

import { LocalizedDateField } from '../../components/LocalizedDateField';
import { JobLocationFields } from '../../components/JobLocationFields';
import { ClientForm } from '../../components/clients/ClientEditorForm';
import { clientSiteDefaults } from './clientJobDraft';
import type { ClientRow } from '../../../shared/types/ipc';
import { dismissOnEscOnly } from '../../components/modalDismiss';

export interface EditJobForm {
  name: string;
  jobNumber: string;
  client: string;
  location: string;
  sitePostcode: string;
  siteCountry: string;
  bidDate: string;
  description: string;
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  taxPercent: number;
  escalationPercent: number;
  freight: number;
}

interface EditJobModalProps {
  form: EditJobForm;
  setForm: (form: EditJobForm) => void;
  onSave: () => void;
  onClose: () => void;
  /** Excluded from the duplicate-number warning (a job matches itself). */
  jobId?: number;
}

/** Edit-job info + markups modal, extracted from JobDetail. */
export function EditJobModal({
  form, setForm, onSave, onClose, jobId,
}: EditJobModalProps) {
  const numberWarning = useJobNumberWarning(form.jobNumber, jobId);
  const { profile } = useLocaleStore();

  const [selectedClientRow, setSelectedClientRow] = React.useState<ClientRow | null>(null);
  const [editingClient, setEditingClient] = React.useState(false);
  const [isDateValid, setIsDateValid] = React.useState(true);

  React.useEffect(() => {
    if (form.client.trim()) {
      window.api.searchClients(form.client, 1).then((results) => {
        const match = results.find(c => c.name.toLowerCase() === form.client.toLowerCase());
        if (match) {
          setSelectedClientRow(match);
        } else {
          setSelectedClientRow(null);
        }
      }).catch(console.warn);
    } else {
      setSelectedClientRow(null);
    }
  }, [form.client]);

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Job</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Job Name</label>
            <input type="text" className="form-control" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus />
          </div>
          <div className="form-group">
            <label>Job Number</label>
            <input type="text" className="form-control" value={form.jobNumber}
              onChange={(e) => setForm({ ...form, jobNumber: e.target.value })}
              placeholder="optional" />
            {numberWarning && (
              <div className="text-warning" style={{ fontSize: 12, marginTop: 4 }}>{numberWarning}</div>
            )}
          </div>
        </div>
        <div className="form-group" style={{ position: 'relative' }}>
          <label>Client / Builder</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <SavedClientPicker
                value={form.client}
                onChange={(clientName) => {
                  setForm({ ...form, client: clientName });
                  if (!clientName.trim()) {
                    setSelectedClientRow(null);
                  }
                }}
                onSelectClient={(client) => {
                  setForm({
                    ...form,
                    client: client.name,
                    ...clientSiteDefaults(form, client, profile),
                  });
                  setSelectedClientRow(client);
                }}
                disabled={false}
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 12px', height: '38px', whiteSpace: 'nowrap' }}
              onClick={() => {
                setSelectedClientRow(null);
                setEditingClient(true);
              }}
            >
              + New Client
            </button>
            {selectedClientRow && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '6px 12px', height: '38px', whiteSpace: 'nowrap' }}
                onClick={() => setEditingClient(true)}
              >
                Edit Details
              </button>
            )}
          </div>
          {editingClient && (
            <div className="modal-overlay" onClick={dismissOnEscOnly(() => setEditingClient(false))} style={{ zIndex: 1100 }}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <h3>{selectedClientRow ? 'Edit Client' : 'Add Client'}</h3>
                <ClientForm
                  initialClient={selectedClientRow}
                  onSaved={(client) => {
                    setSelectedClientRow(client);
                    setForm({
                      ...form,
                      client: client.name,
                      ...clientSiteDefaults(form, client, profile),
                    });
                    setEditingClient(false);
                  }}
                  onCancel={() => setEditingClient(false)}
                />
              </div>
            </div>
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <LocalizedDateField
              label="Bid Date"
              value={form.bidDate || null}
              onChange={(date) => setForm({ ...form, bidDate: date || '' })}
              onValidityChange={setIsDateValid}
            />
          </div>
        </div>
        <div className="form-group">
          <JobLocationFields
            location={form.location}
            postalCode={form.sitePostcode}
            country={form.siteCountry}
            onLocationChange={(loc) => setForm({ ...form, location: loc })}
            onPostalCodeChange={(pc) => setForm({ ...form, sitePostcode: pc })}
            onCountryChange={(c) => setForm({ ...form, siteCountry: c })}
            builderAddress={selectedClientRow?.address}
          />
        </div>
        <div className="form-group">
          <label>Description</label>
          <input type="text" className="form-control" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 8px' }}>Markups &amp; Escalation</div>
        <div className="form-row">
          <div className="form-group">
            <label>Overhead %</label>
            <input type="number" className="form-control" value={form.overheadPercent} step="0.5"
              onChange={(e) => setForm({ ...form, overheadPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label>Profit %</label>
            <input type="number" className="form-control" value={form.profitPercent} step="0.5"
              onChange={(e) => setForm({ ...form, profitPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label>Bond %</label>
            <input type="number" className="form-control" value={form.bondPercent} step="0.1"
              onChange={(e) => setForm({ ...form, bondPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label>{profile.taxLabel} %</label>
            <input type="number" className="form-control" value={form.taxPercent} step="0.1"
              onChange={(e) => setForm({ ...form, taxPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label title="Material price escalation for long-lead bids. Raises material direct cost before markups.">Escalation %</label>
            <input type="number" className="form-control" value={form.escalationPercent} step="0.5"
              onChange={(e) => setForm({ ...form, escalationPercent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label>Freight ($)</label>
            <input type="number" className="form-control" value={form.freight}
              onChange={(e) => setForm({ ...form, freight: parseFloat(e.target.value) || 0 })} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!form.name.trim() || !isDateValid}>Save</button>
        </div>
      </div>
    </div>
  );
}
