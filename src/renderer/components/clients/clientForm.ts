import type { ClientRow, SaveClientPayload } from '../../../shared/types/ipc';
import type { LocaleProfile } from '../../../shared/localeProfiles';

/**
 * Whether this locale captures addresses as separate street/suburb/state/
 * postcode fields. Everything below that used to be gated on
 * `profile.id === 'en-AU'` is gated on this instead — a capability of the
 * locale, not a country name baked into a component.
 */
function isStructuredAddress(profile: Pick<LocaleProfile, 'addressFormat'>): boolean {
  return profile.addressFormat === 'structured';
}

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
  /**
   * Carried on the state so the derived transitions below (adopt, detach,
   * complete, cancel) rebuild a form the same way the original was built,
   * without every one of them needing the locale profile passed in.
   */
  addressFormat: LocaleProfile['addressFormat'];
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

export function clientFormFromClient(
  client: ClientRow | null,
  profile: Pick<LocaleProfile, 'addressFormat'>,
): ClientFormState {
  const values = createEmptyClientForm();
  if (client) {
    values.id = client.id;
    values.name = client.name ?? '';
    values.contactName = client.contact_name ?? '';
    values.contactEmail = client.contact_email ?? '';
    values.contactPhone = client.contact_phone ?? '';
    values.address = client.address ?? '';
    values.notes = client.notes ?? '';

    // Only split the stored block into sub-fields where the form actually
    // shows them. Parsing unconditionally is what made prepareClientPayload
    // recompose (and re-prepend the name lines to) a US address the estimator
    // had just retyped — the edit was discarded and the field grew two lines
    // on every save until it hit the 500-char bound and blocked saving.
    if (isStructuredAddress(profile)) {
      const parsed = parseClientAddress(client.address);
      values.street = parsed.street;
      values.suburb = parsed.suburb;
      values.state = parsed.state;
      values.postcode = parsed.postcode;
    }
  }
  return {
    mode: client ? 'edit' : 'create',
    addressFormat: profile.addressFormat,
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

export function prepareClientPayload(
  values: ClientFormValues,
  profile: Pick<LocaleProfile, 'addressFormat'>,
): PreparedClientPayload {
  const errors: Partial<Record<keyof ClientFormValues, string>> = {};
  const payload: Record<string, string | number | null | undefined> = {
    id: values.id,
  };

  // Compose the address block from the sub-fields ONLY where the form
  // captures them. Outside a structured-address locale the address field is
  // what the user typed, and it is stored as typed.
  let finalAddress = values.address;
  if (
    isStructuredAddress(profile) &&
    (values.street.trim() || values.suburb.trim() || values.state.trim() || values.postcode.trim())
  ) {
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

/**
 * True while a from-scratch draft could still adopt an existing client's
 * record: create mode, not mid-save, and nothing typed beyond the name.
 * Once any detail field has content, adoption would clobber the user's
 * typing, so the draft stays a new-client draft (the backend's merge
 * semantics still protect the stored record on save).
 */
export function canAdoptExistingClient(state: ClientFormState): boolean {
  if (state.mode !== 'create' || state.saving) return false;
  const v = state.values;
  return (
    !v.contactName.trim() && !v.contactEmail.trim() && !v.contactPhone.trim() &&
    !v.address.trim() && !v.notes.trim() &&
    !v.street.trim() && !v.suburb.trim() && !v.state.trim() && !v.postcode.trim()
  );
}

/**
 * Adopt an existing client into the form: prefill every field from the
 * stored record and switch to edit mode so the save carries the id (and
 * deliberate clearing works). The typed name is replaced by the record's
 * canonical casing.
 */
export function adoptExistingClient(
  state: ClientFormState,
  match: ClientRow,
): ClientFormState {
  if (!canAdoptExistingClient(state)) return state;
  return clientFormFromClient(match, state);
}

/**
 * A fresh create-mode draft carrying only the typed name. Used when the user
 * types onward past an adopted client's name ("Boh Bros" -> "Boh Bros
 * Marine"): the adoption must unwind — keeping the adopted id would turn the
 * save into a silent rename of the existing client, and the prefilled fields
 * belong to that client, not the new one.
 */
export function detachToNewClientDraft(
  name: string,
  profile: Pick<LocaleProfile, 'addressFormat'>,
): ClientFormState {
  const fresh = clientFormFromClient(null, profile);
  fresh.values.name = name;
  return fresh;
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
      ...clientFormFromClient(storedClient, state),
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
    ? clientFormFromClient(state.originalClient, state).values
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
