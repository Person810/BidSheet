import type { ClientRow, SaveClientPayload } from '../../../shared/types/ipc';

export type ClientFormTextField = Exclude<keyof SaveClientPayload, 'id'>;

export interface ClientFormValues extends Record<ClientFormTextField, string> {
  id: number | undefined;
}

export interface ClientFormState {
  mode: 'create' | 'edit';
  values: ClientFormValues;
  originalClient: ClientRow | null;
  refreshedClient: ClientRow | null;
  saving: boolean;
  error: string | null;
  cancelled: boolean;
  missingRecord: boolean;
}

export interface PreparedClientPayload {
  ok: boolean;
  payload?: SaveClientPayload;
  errors: Partial<Record<ClientFormTextField, string>>;
}

const FIELD_BOUNDS: Record<ClientFormTextField, number> = {
  name: 200,
  contactName: 200,
  contactEmail: 320,
  contactPhone: 100,
  address: 500,
  notes: 2_000,
};

export function createEmptyClientForm(): ClientFormValues {
  return {
    id: undefined,
    name: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    notes: '',
  };
}

export function clientFormFromClient(client: ClientRow | null): ClientFormState {
  const values = createEmptyClientForm();
  if (client) {
    values.id = client.id;
    values.name = client.name ?? '';
    values.contactName = client.contact_name ?? '';
    values.contactEmail = client.contact_email ?? '';
    values.contactPhone = client.contact_phone ?? '';
    values.address = client.address ?? '';
    values.notes = client.notes ?? '';
  }
  return {
    mode: client ? 'edit' : 'create',
    values,
    originalClient: client,
    refreshedClient: null,
    saving: false,
    error: null,
    cancelled: false,
    missingRecord: false,
  };
}

function normalize(value: string): string | null {
  const result = value.normalize('NFKC').trim();
  return result || null;
}

function fieldLabel(field: ClientFormTextField): string {
  return field.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

export function prepareClientPayload(values: ClientFormValues): PreparedClientPayload {
  const errors: Partial<Record<ClientFormTextField, string>> = {};
  const payload: Record<string, string | number | null | undefined> = {
    id: values.id,
  };

  for (const [field, bound] of Object.entries(FIELD_BOUNDS) as Array<
    [ClientFormTextField, number]
  >) {
    const value = normalize(values[field]);
    if (field === 'name' && value == null) {
      errors.name = 'Client name is required.';
    } else if (value != null && value.length > bound) {
      errors[field] = `Client ${fieldLabel(field)} must be ${bound} characters or fewer.`;
    }
    payload[field] = value;
  }

  const email = payload.contactEmail;
  if (
    typeof email === 'string' &&
    !errors.contactEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    errors.contactEmail = 'Enter a valid email address.';
  }

  if (Object.keys(errors).length) return { ok: false, errors, payload: undefined };
  if (payload.id === undefined) delete payload.id;
  return { ok: true, errors, payload: payload as unknown as SaveClientPayload };
}

export function beginClientSave(
  state: ClientFormState,
): { state: ClientFormState; shouldSubmit: boolean } {
  if (state.saving) return { state, shouldSubmit: false };
  return {
    state: {
      ...state,
      saving: true,
      error: null,
      cancelled: false,
      missingRecord: false,
      refreshedClient: null,
    },
    shouldSubmit: true,
  };
}

export function completeClientSave(
  state: ClientFormState,
  storedClient?: ClientRow,
): ClientFormState {
  if (storedClient) {
    return {
      ...clientFormFromClient(storedClient),
      refreshedClient: storedClient,
    };
  }
  return {
    ...state,
    saving: false,
    error: null,
    cancelled: false,
    missingRecord: false,
  };
}

export function failClientSave(
  state: ClientFormState,
  reason: unknown,
): ClientFormState {
  const message = reason instanceof Error
    ? reason.message
    : String(reason || 'Could not save client.');
  return {
    ...state,
    saving: false,
    error: message,
    cancelled: false,
    missingRecord: /client not found/i.test(message),
  };
}

export function cancelClientForm(state: ClientFormState): ClientFormState {
  const original = state.originalClient
    ? clientFormFromClient(state.originalClient).values
    : createEmptyClientForm();
  return {
    ...state,
    values: original,
    refreshedClient: null,
    saving: false,
    error: null,
    cancelled: true,
    missingRecord: false,
  };
}

export function clientRowFromPendingPayload(
  payload: SaveClientPayload,
  original: ClientRow | null,
): ClientRow {
  const timestamp = original?.updated_at ?? new Date(0).toISOString();
  return {
    id: payload.id ?? original?.id ?? -1,
    name: payload.name,
    contact_name: payload.contactName ?? null,
    contact_email: payload.contactEmail ?? null,
    contact_phone: payload.contactPhone ?? null,
    address: payload.address ?? null,
    notes: payload.notes ?? null,
    is_active: 1,
    uuid: original?.uuid ?? '',
    created_at: original?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}
