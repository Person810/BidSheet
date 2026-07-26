export interface ClientFormValues {
  id: number | undefined;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  notes: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
}

export type ClientFormTextField = keyof ClientFormValues;

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
  errors: Partial<Record<keyof ClientFormValues, string>>;
}

const FIELD_BOUNDS: Record<string, number> = {
  name: 200,
  contactName: 200,
  contactEmail: 320,
  contactPhone: 100,
  address: 500,
  notes: 2_000,
  street: 200,
  suburb: 100,
  state: 10,
  postcode: 20,
};

export function parseClientAddress(address: string | null | undefined): {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
} {
  const result = { street: '', suburb: '', state: '', postcode: '' };
  if (!address) return result;

  const lines = address.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return result;

  const lastLine = lines[lines.length - 1];
  const match = /(?<suburb>[A-Z\s]+)\s+(?<state>[A-Z]{2,3})\s+(?<postcode>\d{4})$/i.exec(lastLine);

  if (match && match.groups) {
    result.postcode = match.groups.postcode.trim();
    result.state = match.groups.state.trim();
    result.suburb = match.groups.suburb.trim();
    // Street line is the one before suburb state postcode
    result.street = lines.length >= 2 ? lines[lines.length - 2] : '';
  } else {
    result.street = lines.join('\n');
  }

  return result;
}

export function formatClientAddress(
  businessName: string,
  recipientName: string,
  street: string,
  suburb: string,
  state: string,
  postcode: string,
): string {
  const lines: string[] = [];

  if (businessName.trim() && recipientName.trim()) {
    lines.push(businessName.trim());
    lines.push(recipientName.trim());
  } else if (businessName.trim()) {
    lines.push(businessName.trim());
  } else if (recipientName.trim()) {
    lines.push(recipientName.trim());
  }

  if (street.trim()) {
    lines.push(street.trim());
  }

  const suburbStatePostcode = `${suburb.trim().toUpperCase()} ${state.trim().toUpperCase()} ${postcode.trim()}`;
  if (suburbStatePostcode.trim()) {
    lines.push(suburbStatePostcode);
  }

  return lines.join('\n');
}

export function createEmptyClientForm(): ClientFormValues {
  return {
    id: undefined,
    name: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    notes: '',
    street: '',
    suburb: '',
    state: '',
    postcode: '',
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

    const parsed = parseClientAddress(client.address);
    values.street = parsed.street;
    values.suburb = parsed.suburb;
    values.state = parsed.state;
    values.postcode = parsed.postcode;
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

function fieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

export function prepareClientPayload(values: ClientFormValues): PreparedClientPayload {
  const errors: Partial<Record<keyof ClientFormValues, string>> = {};
  const payload: Record<string, string | number | null | undefined> = {
    id: values.id,
  };

  // If using separate fields for Australia Post, format the combined address
  let finalAddress = values.address;
  if (values.street.trim() || values.suburb.trim() || values.state.trim() || values.postcode.trim()) {
    finalAddress = formatClientAddress(
      values.name,
      values.contactName,
      values.street,
      values.suburb,
      values.state,
      values.postcode
    );
  }

  const valuesToValidate = {
    ...values,
    address: finalAddress,
  };

  const keysToValidate = ['name', 'contactName', 'contactEmail', 'contactPhone', 'address', 'notes', 'street', 'suburb', 'state', 'postcode'];

  for (const field of keysToValidate) {
    const value = normalize((valuesToValidate as any)[field] || '');
    const bound = FIELD_BOUNDS[field];
    if (field === 'name' && value == null) {
      errors.name = 'Client name is required.';
    } else if (value != null && value.length > bound) {
      errors[field as keyof ClientFormValues] = `Client ${fieldLabel(field)} must be ${bound} characters or fewer.`;
    }
    if (['name', 'contactName', 'contactEmail', 'contactPhone', 'address', 'notes'].includes(field)) {
      payload[field] = value;
    }
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
