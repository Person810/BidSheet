import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ClientRow } from '../../shared/types/ipc';
import { clientSummaryParts } from './clientSummary';

/**
 * Client picker for the job forms (#94): a free-text input with known-client
 * suggestions, plus an optional inline details editor so a client's
 * address/contact info can be added or fixed without leaving the job form.
 *
 * The field never tracks client ids — the typed name is the identity, and
 * db:jobs:save links (or creates) the matching client record on save. The
 * parent owns the details draft: null means "not editing details" (nothing
 * is written), non-null is committed via commitClientDetails() alongside
 * the job save.
 */

export interface ClientDetailsDraft {
  address: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
}

export const EMPTY_CLIENT_DETAILS: ClientDetailsDraft = {
  address: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
};

function detailsFromClient(c: ClientRow): ClientDetailsDraft {
  return {
    address: c.address || '',
    contactName: c.contact_name || '',
    contactPhone: c.contact_phone || '',
    contactEmail: c.contact_email || '',
    notes: c.notes || '',
  };
}

/** Persist an edited details draft for the (possibly new) client `name`. */
export async function commitClientDetails(
  name: string,
  details: ClientDetailsDraft | null
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || !details) return;
  await window.api.saveClient({
    name: trimmed,
    address: details.address.trim() || null,
    contactName: details.contactName.trim() || null,
    contactPhone: details.contactPhone.trim() || null,
    contactEmail: details.contactEmail.trim() || null,
    notes: details.notes.trim() || null,
  });
}

const norm = (s: string) => s.trim().toLowerCase();

interface ClientFieldProps {
  value: string;
  onChange: (name: string) => void;
  details: ClientDetailsDraft | null;
  onDetailsChange: (details: ClientDetailsDraft | null) => void;
  placeholder?: string;
}

export function ClientField({ value, onChange, details, onDetailsChange, placeholder }: ClientFieldProps) {
  const listId = useId();
  const [clients, setClients] = useState<ClientRow[]>([]);
  // Which client (normalized name) the open details were prefilled from, so
  // renaming away from it discards the draft instead of copying one client's
  // details onto another's name. Null = a from-scratch draft that follows
  // whatever name ends up in the field.
  const prefilledFrom = useRef<string | null>(null);

  useEffect(() => {
    window.api.getClients().then(setClients).catch(() => setClients([]));
  }, []);

  const findMatch = (name: string): ClientRow | undefined =>
    clients.find((c) => norm(c.name) === norm(name) && norm(name) !== '');

  const matched = useMemo(() => findMatch(value), [clients, value]);

  const handleNameChange = (v: string) => {
    onChange(v);
    if (!details) return;
    const m = findMatch(v);
    if (prefilledFrom.current !== null) {
      if (norm(v) !== prefilledFrom.current) {
        // Renamed away from the prefill source: swap to the new match's
        // details, or close the draft entirely.
        prefilledFrom.current = m ? norm(m.name) : null;
        onDetailsChange(m ? detailsFromClient(m) : null);
      }
    } else if (m) {
      // A from-scratch draft just landed on an existing client — show that
      // client's saved details rather than silently overwriting them.
      prefilledFrom.current = norm(m.name);
      onDetailsChange(detailsFromClient(m));
    }
  };

  const openDetails = () => {
    if (matched) {
      prefilledFrom.current = norm(matched.name);
      onDetailsChange(detailsFromClient(matched));
    } else {
      prefilledFrom.current = null;
      onDetailsChange({ ...EMPTY_CLIENT_DETAILS });
    }
  };

  // Same summary the job header shows (#110), plus the job count — which only
  // means anything here, where you're deciding whether this is the client you
  // meant.
  const summaryParts: string[] = [];
  if (matched) {
    summaryParts.push(...clientSummaryParts(matched));
    const count = matched.job_count ?? 0;
    if (count > 0) summaryParts.push(`${count} job${count !== 1 ? 's' : ''}`);
  }

  const setField = (field: keyof ClientDetailsDraft, v: string) => {
    if (details) onDetailsChange({ ...details, [field]: v });
  };

  return (
    <div>
      <input
        type="text"
        className="form-control"
        list={listId}
        value={value}
        onChange={(e) => handleNameChange(e.target.value)}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {clients.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      {!details && value.trim() !== '' && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            {matched
              ? summaryParts.length > 0
                ? summaryParts.join(' · ')
                : 'Known client'
              : 'New client — saved with this job'}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ fontSize: 11, padding: '1px 8px' }}
            onClick={openDetails}
          >
            {matched ? 'Edit details' : 'Add details'}
          </button>
        </div>
      )}

      {details && (
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          <input type="text" className="form-control" value={details.address}
            onChange={(e) => setField('address', e.target.value)} placeholder="Address" />
          <div className="form-row" style={{ margin: 0 }}>
            <input type="text" className="form-control" value={details.contactName}
              onChange={(e) => setField('contactName', e.target.value)} placeholder="Contact name" />
            <input type="text" className="form-control" value={details.contactPhone}
              onChange={(e) => setField('contactPhone', e.target.value)} placeholder="Phone" />
          </div>
          <input type="text" className="form-control" value={details.contactEmail}
            onChange={(e) => setField('contactEmail', e.target.value)} placeholder="Email" />
          <input type="text" className="form-control" value={details.notes}
            onChange={(e) => setField('notes', e.target.value)} placeholder="Notes" />
          <div className="text-muted" style={{ fontSize: 11 }}>
            Saved to this client&apos;s record for every job that uses them.
          </div>
        </div>
      )}
    </div>
  );
}
