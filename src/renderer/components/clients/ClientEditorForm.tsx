import React, { useId, useRef, useState } from 'react';

import type { ClientRow, SaveClientPayload } from '../../../shared/types/ipc';
import {
  beginClientSave,
  cancelClientForm,
  clientFormFromClient,
  completeClientSave,
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
  const [state, setState] = useState(() => clientFormFromClient(initialClient));
  const [errors, setErrors] = useState<
    Partial<Record<ClientFormTextField, string>>
  >({});

  const update = (field: ClientFormTextField, value: string) => {
    setState((current) => ({
      ...current,
      values: { ...current.values, [field]: value },
      error: null,
      cancelled: false,
    }));
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
          value={state.values[name] as string}
          disabled={disabled || state.saving}
          required={name === 'name'}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? errorId : undefined}
          onChange={(event) => update(name, event.target.value)}
        />
        {errors[name] && (
          <div id={errorId} className="form-error" role="alert">
            {errors[name]}
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

      {FIELDS.slice(0, 2).map(field)}
      <div className="form-row">{FIELDS.slice(2, 4).map(field)}</div>

      <div className="form-group">
        <label htmlFor={`${idPrefix}-address`}>Address</label>
        <textarea
          id={`${idPrefix}-address`}
          className="form-control"
          value={state.values.address as string}
          disabled={disabled || state.saving}
          aria-invalid={Boolean(errors.address)}
          aria-describedby={errors.address ? `${idPrefix}-address-error` : undefined}
          onChange={(event) => update('address' as ClientFormTextField, event.target.value)}
        />
        {errors.address && (
          <div id={`${idPrefix}-address-error`} className="form-error" role="alert">
            {errors.address}
          </div>
        )}
      </div>

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
