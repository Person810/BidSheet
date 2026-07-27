import React, { useEffect, useId, useRef, useState } from 'react';

import type { ClientRow, SaveClientPayload } from '../../../shared/types/ipc';
import { useLocaleStore } from '../../stores/locale-store';
import {
  adoptExistingClient,
  beginClientSave,
  canAdoptExistingClient,
  cancelClientForm,
  clientFormFromClient,
  completeClientSave,
  detachToNewClientDraft,
  failClientSave,
  prepareClientPayload,
  type ClientFormTextField,
  type ClientFormValues,
} from './clientForm';

export interface ClientFormProps {
  initialClient?: ClientRow | null;
  onSaved: (client: ClientRow) => void;
  onCancel: () => void;
  disabled?: boolean;
  persistClient?: (payload: SaveClientPayload) => Promise<ClientRow>;
}

const persistClientWithApi = async (payload: SaveClientPayload): Promise<ClientRow> => {
  const result = await window.api.saveClient(payload);
  // The stored row is authoritative: an id-less save may have merged into an
  // existing client, so a row fabricated from the payload would misreport
  // that client's details as blank — and feed the next Edit Details session
  // nulls that a save would then make real.
  try {
    const stored = await window.api.getClient(result.id);
    if (stored) return stored;
  } catch {
    // Fall through to the payload-shaped row below.
  }
  return {
    id: result.id,
    name: payload.name,
    contact_name: payload.contactName ?? null,
    contact_email: payload.contactEmail ?? null,
    contact_phone: payload.contactPhone ?? null,
    address: payload.address ?? null,
    notes: payload.notes ?? null,
    is_active: 1,
    uuid: '',
    created_at: '',
    updated_at: '',
  };
};

interface FieldDefinition {
  name: ClientFormTextField;
  label: string;
  type?: 'text' | 'email' | 'tel';
  autoComplete?: string;
}

const FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Client name', autoComplete: 'organization' },
  { name: 'contactName', label: 'Contact name', autoComplete: 'name' },
  { name: 'contactEmail', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'contactPhone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
];

export function ClientForm({
  initialClient = null,
  onSaved,
  onCancel,
  disabled = false,
  persistClient = persistClientWithApi,
}: ClientFormProps) {
  const idPrefix = useId();
  const savingRef = useRef(false);
  const { profile } = useLocaleStore();
  const isAU = profile.id === 'en-AU';
  const [state, setState] = useState(() => clientFormFromClient(initialClient));
  const [errors, setErrors] = useState<
    Partial<Record<keyof ClientFormValues, string>>
  >({});

  // A blank "new client" form typed with an existing client's name is the
  // data-loss path (#110): saving used to null out that client's stored
  // details. Adopt the existing record instead — prefill everything and
  // switch to editing it by id. The sequence counter drops stale lookups,
  // and the functional setState re-checks adoptability at commit time so a
  // response can never overwrite something the user typed meanwhile.
  const lookupSeq = useRef(0);
  const typedName = state.values.name.trim();
  useEffect(() => {
    if (initialClient) return; // opened on a known record — nothing to adopt
    if (!typedName || !canAdoptExistingClient(state)) return;
    const seq = ++lookupSeq.current;
    const timer = setTimeout(async () => {
      try {
        const matches = await window.api.searchClients(typedName, 20);
        if (seq !== lookupSeq.current) return; // a newer lookup superseded us
        const wanted = typedName.toLowerCase();
        const exact = matches.find((c) => c.name.trim().toLowerCase() === wanted);
        if (!exact) return;
        setState((current) =>
          current.values.name.trim().toLowerCase() === wanted
            ? adoptExistingClient(current, exact)
            : current,
        );
      } catch {
        // Best-effort: a failed lookup just means no prefill. The backend's
        // id-less merge still protects the stored record on save.
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedName, initialClient]);

  const update = (field: keyof ClientFormValues, value: string) => {
    setState((current) => {
      // Typing the name onward past an adopted match unwinds the adoption:
      // the prefilled fields belong to the matched client, and keeping its
      // id would turn this save into a rename of that client.
      if (
        field === 'name' &&
        !initialClient &&
        current.mode === 'edit' &&
        current.originalClient &&
        value.trim().toLowerCase() !== current.originalClient.name.trim().toLowerCase()
      ) {
        return detachToNewClientDraft(value);
      }
      return {
        ...current,
        values: { ...current.values, [field]: value },
        error: null,
        cancelled: false,
      };
    });
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const field = ({ name, label, type = 'text', autoComplete }: FieldDefinition) => {
    const inputId = `${idPrefix}-${name}`;
    const errorId = `${inputId}-error`;
    return (
      <div className="form-group" key={name}>
        <label htmlFor={inputId}>{label}{name === 'name' ? ' *' : ''}</label>
        <input
          id={inputId}
          className="form-control"
          type={type}
          autoComplete={autoComplete}
          value={state.values[name as keyof ClientFormValues] as string}
          disabled={disabled || state.saving}
          required={name === 'name'}
          aria-invalid={Boolean(errors[name as keyof ClientFormValues])}
          aria-describedby={errors[name as keyof ClientFormValues] ? errorId : undefined}
          onChange={(event) => update(name as keyof ClientFormValues, event.target.value)}
        />
        {errors[name as keyof ClientFormValues] && (
          <div id={errorId} className="form-error" role="alert">
            {errors[name as keyof ClientFormValues]}
          </div>
        )}
      </div>
    );
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const prepared = prepareClientPayload(state.values);
    setErrors(prepared.errors);
    if (!prepared.ok || !prepared.payload || savingRef.current) return;

    const started = beginClientSave(state);
    if (!started.shouldSubmit) return;
    savingRef.current = true;
    setState(started.state);
    try {
      const stored = await persistClient(prepared.payload);
      savingRef.current = false;
      setState((current) => completeClientSave(current, stored));
      onSaved(stored);
    } catch (reason) {
      savingRef.current = false;
      setState((current) => failClientSave(current, reason));
    }
  };

  const cancel = () => {
    if (state.saving) return;
    setState((current) => cancelClientForm(current));
    onCancel();
  };

  return (
    <form
      onSubmit={save}
      noValidate
      aria-label={state.mode === 'edit' ? 'Edit client' : 'Add client'}
    >
      <div role={state.error ? 'alert' : 'status'} aria-live="polite" className="form-error">
        {state.error}
      </div>
      {!initialClient && state.mode === 'edit' && (
        <div className="text-muted" role="status" style={{ fontSize: 12, marginBottom: 8 }}>
          Existing client — editing their saved details.
        </div>
      )}

      {FIELDS.slice(0, 2).map(field)}
      <div className="form-row">{FIELDS.slice(2, 4).map(field)}</div>

      {isAU ? (
        <>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-street`}>Street Address</label>
            <input
              id={`${idPrefix}-street`}
              className="form-control"
              type="text"
              value={state.values.street}
              disabled={disabled || state.saving}
              aria-invalid={Boolean(errors.street)}
              aria-describedby={errors.street ? `${idPrefix}-street-error` : undefined}
              onChange={(event) => update('street', event.target.value)}
            />
            {errors.street && (
              <div id={`${idPrefix}-street-error`} className="form-error" role="alert">
                {errors.street}
              </div>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={`${idPrefix}-suburb`}>Suburb / Locality</label>
              <input
                id={`${idPrefix}-suburb`}
                className="form-control"
                type="text"
                value={state.values.suburb}
                disabled={disabled || state.saving}
                aria-invalid={Boolean(errors.suburb)}
                aria-describedby={errors.suburb ? `${idPrefix}-suburb-error` : undefined}
                onChange={(event) => update('suburb', event.target.value)}
              />
              {errors.suburb && (
                <div id={`${idPrefix}-suburb-error`} className="form-error" role="alert">
                  {errors.suburb}
                </div>
              )}
            </div>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-state`}>State</label>
              <input
                id={`${idPrefix}-state`}
                className="form-control"
                type="text"
                value={state.values.state}
                disabled={disabled || state.saving}
                aria-invalid={Boolean(errors.state)}
                aria-describedby={errors.state ? `${idPrefix}-state-error` : undefined}
                onChange={(event) => update('state', event.target.value)}
              />
              {errors.state && (
                <div id={`${idPrefix}-state-error`} className="form-error" role="alert">
                  {errors.state}
                </div>
              )}
            </div>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-postcode`}>Postcode</label>
              <input
                id={`${idPrefix}-postcode`}
                className="form-control"
                type="text"
                value={state.values.postcode}
                disabled={disabled || state.saving}
                aria-invalid={Boolean(errors.postcode)}
                aria-describedby={errors.postcode ? `${idPrefix}-postcode-error` : undefined}
                onChange={(event) => update('postcode', event.target.value)}
              />
              {errors.postcode && (
                <div id={`${idPrefix}-postcode-error`} className="form-error" role="alert">
                  {errors.postcode}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="form-group">
          <label htmlFor={`${idPrefix}-address`}>Address</label>
          <textarea
            id={`${idPrefix}-address`}
            className="form-control"
            value={state.values.address}
            disabled={disabled || state.saving}
            aria-invalid={Boolean(errors.address)}
            aria-describedby={errors.address ? `${idPrefix}-address-error` : undefined}
            onChange={(event) => update('address', event.target.value)}
          />
          {errors.address && (
            <div id={`${idPrefix}-address-error`} className="form-error" role="alert">
              {errors.address}
            </div>
          )}
        </div>
      )}

      <div className="form-group">
        <label htmlFor={`${idPrefix}-notes`}>Notes</label>
        <textarea
          id={`${idPrefix}-notes`}
          className="form-control"
          value={state.values.notes as string}
          disabled={disabled || state.saving}
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? `${idPrefix}-notes-error` : undefined}
          onChange={(event) => update('notes' as ClientFormTextField, event.target.value)}
        />
        {errors.notes && (
          <div id={`${idPrefix}-notes-error`} className="form-error" role="alert">
            {errors.notes}
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || state.saving}
          onClick={cancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={disabled || state.saving}
        >
          {state.saving
            ? 'Saving…'
            : state.mode === 'edit'
              ? 'Save changes'
              : 'Save client'}
        </button>
      </div>
    </form>
  );
}

export type { ClientFormValues };
