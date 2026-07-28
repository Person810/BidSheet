import { describe, expect, it } from 'vitest';
import type { ClientRow } from '../../../shared/types/ipc';

import {
  adoptExistingClient,
  beginClientSave,
  detachToNewClientDraft,
  canAdoptExistingClient,
  cancelClientForm,
  clientFormFromClient,
  completeClientSave,
  createEmptyClientForm,
  failClientSave,
  prepareClientPayload,
  parseClientAddress,
  formatClientAddress,
  type ClientFormValues,
} from './clientForm';

function valid(overrides: Partial<ClientFormValues> = {}): ClientFormValues {
  return {
    ...createEmptyClientForm(),
    name: 'Acme Civil',
    contactEmail: 'estimating@acme.test',
    ...overrides,
  };
}

describe('client form payload preparation', () => {
  it('creates an empty controlled form with no reusable identity', () => {
    expect(createEmptyClientForm()).toEqual({
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
    });
  });

  it('parses Australia Post standard formatted address correctly', () => {
    // Both business and contact name
    const address = formatClientAddress('Acme Civil', 'Alice Estimator', '10 Client Street', 'Adelaide', 'SA', '5000');
    expect(address).toBe('Acme Civil\nAlice Estimator\n10 Client Street\nADELAIDE SA 5000');

    const parsed = parseClientAddress(address);
    expect(parsed).toEqual({
      street: '10 Client Street',
      suburb: 'ADELAIDE',
      state: 'SA',
      postcode: '5000',
    });

    // Only business name
    const addressOnlyBusiness = formatClientAddress('Acme Civil', '', '10 Client Street', 'Adelaide', 'SA', '5000');
    expect(addressOnlyBusiness).toBe('Acme Civil\n10 Client Street\nADELAIDE SA 5000');

    // Only contact name
    const addressOnlyContact = formatClientAddress('', 'Alice Estimator', '10 Client Street', 'Adelaide', 'SA', '5000');
    expect(addressOnlyContact).toBe('Alice Estimator\n10 Client Street\nADELAIDE SA 5000');
  });

  it('normalizes surrounding Unicode whitespace and blank optionals to null', () => {
    const result = prepareClientPayload(valid({
      name: '  Acme Civil  ',
      contactName: '  Alice Estimator ',
      contactPhone: '   ',
      address: '\t10 Client Street\n',
      notes: '',
    }));

    expect(result).toEqual({
      ok: true,
      errors: {},
      payload: expect.objectContaining({
        name: 'Acme Civil',
        contactName: 'Alice Estimator',
        contactEmail: 'estimating@acme.test',
        contactPhone: null,
        address: '10 Client Street',
        notes: null,
      }),
    });
  });

  it('requires a nonblank client name', () => {
    expect(prepareClientPayload(valid({ name: ' \t ' }))).toMatchObject({
      ok: false,
      errors: { name: 'Client name is required.' },
      payload: undefined,
    });
  });

  it.each([
    ['name', 201],
    ['contactEmail', 321],
    ['contactPhone', 101],
    ['address', 501],
    ['notes', 2001],
  ] as const)('rejects %s beyond its agreed bound', (field, length) => {
    const result = prepareClientPayload(valid({ [field]: 'x'.repeat(length) }));
    expect(result.ok).toBe(false);
    expect(result.errors[field]).toMatch(/characters or fewer/i);
  });

  it('rejects a malformed nonblank contactEmail but permits a blank contactEmail', () => {
    expect(prepareClientPayload(valid({ contactEmail: 'not-an-email' }))).toMatchObject({
      ok: false,
      errors: { contactEmail: 'Enter a valid email address.' },
    });
    expect(prepareClientPayload(valid({ contactEmail: '  ' }))).toMatchObject({
      ok: true,
      payload: { contactEmail: null },
    });
  });

  it('initializes create state independently from a persisted client', () => {
    const state = clientFormFromClient(null);
    expect(state).toMatchObject({
      values: createEmptyClientForm(),
      saving: false,
      error: null,
      cancelled: false,
    });
  });
});

describe('client form save state', () => {
  it('cancels a new client without producing a payload and resets values', () => {
    const initial = {
      ...clientFormFromClient(null),
      values: valid(),
      error: 'Previous storage failure',
    };

    expect(cancelClientForm(initial)).toMatchObject({
      values: createEmptyClientForm(), // Verify form resets to createEmptyClientForm()
      saving: false,
      error: null,
      cancelled: true,
    });
  });

  it('guards against double-submit until save succeeds or fails', () => {
    const initial = { ...clientFormFromClient(null), values: valid() };
    const first = beginClientSave(initial);
    const second = beginClientSave(first.state);

    expect(first).toMatchObject({ shouldSubmit: true, state: { saving: true } });
    expect(second).toMatchObject({ shouldSubmit: false, state: first.state });

    expect(completeClientSave(first.state)).toMatchObject({
      saving: false,
      error: null,
    });
  });

  it('returns to an editable state and exposes a useful storage failure', () => {
    const saving = beginClientSave({
      ...clientFormFromClient(null),
      values: valid(),
    }).state;

    expect(failClientSave(saving, new Error('Database is read-only'))).toMatchObject({
      saving: false,
      error: 'Database is read-only',
      cancelled: false,
    });
  });
});

describe('client form edit state', () => {
  const persisted: ClientRow = {
    id: 42,
    name: 'Acme Civil',
    contact_name: 'Alice Estimator',
    contact_email: 'alice@acme.test',
    contact_phone: '+61 8 5555 0100',
    address: '10 Client Street',
    notes: null,
    is_active: 1,
    uuid: 'test',
    created_at: '2026-07-17 00:00:00',
    updated_at: '2026-07-17 00:00:00',
  };

  it('initializes edit mode with identity, normalized controls and an original snapshot', () => {
    expect(clientFormFromClient(persisted)).toMatchObject({
      mode: 'edit',
      values: {
        id: 42,
        name: 'Acme Civil',
        contactName: 'Alice Estimator',
        contactEmail: 'alice@acme.test',
        contactPhone: '+61 8 5555 0100',
        address: '10 Client Street',
        notes: '',
      },
      originalClient: persisted,
      saving: false,
    });
  });

  it('cancels edit by restoring the original values without a refresh outcome', () => {
    const editing = clientFormFromClient(persisted);
    editing.values.name = 'Unsaved Name';
    editing.values.contactEmail = 'unsaved@change.test';

    expect(cancelClientForm(editing)).toMatchObject({
      cancelled: true,
      values: {
        id: 42,
        name: 'Acme Civil',
        contactEmail: 'alice@acme.test',
      },
      refreshedClient: null,
    });
  });

  it('marks a missing-record save failure while retaining editable values', () => {
    const editing = {
      ...clientFormFromClient(persisted),
      saving: true,
      values: { ...clientFormFromClient(persisted).values, name: 'Corrected Acme' },
    };

    expect(failClientSave(editing, new Error('Client not found.'))).toMatchObject({
      saving: false,
      missingRecord: true,
      error: 'Client not found.',
      values: { id: 42, name: 'Corrected Acme' },
    });
  });

  it('returns the stored client so only the current unsaved draft can refresh', () => {
    const updated: ClientRow = {
      ...persisted,
      name: 'Acme Civil Pty Ltd',
      contact_email: 'quotes@acme.test',
      updated_at: '2026-07-18 00:00:00',
    };
    const editing = { ...clientFormFromClient(persisted), saving: true };

    expect(completeClientSave(editing, updated)).toMatchObject({
      saving: false,
      refreshedClient: updated,
      originalClient: updated,
      values: {
        id: 42,
        name: 'Acme Civil Pty Ltd',
        contactEmail: 'quotes@acme.test',
      },
    });
  });
});


describe('adopting an existing client into a blank draft', () => {
  const stored = {
    id: 42, name: 'Boh Bros', contact_name: 'Pat', contact_email: 'pat@boh.example',
    contact_phone: '555-0100', address: '55 Office Park Dr', notes: 'net 30',
    is_active: 1, uuid: 'u', created_at: '', updated_at: '',
  } as any;

  it('is allowed only while nothing beyond the name is typed', () => {
    const blank = clientFormFromClient(null);
    blank.values.name = 'Boh Bros';
    expect(canAdoptExistingClient(blank)).toBe(true);

    const dirty = clientFormFromClient(null);
    dirty.values.name = 'Boh Bros';
    dirty.values.contactPhone = '555-9999';
    expect(canAdoptExistingClient(dirty)).toBe(false);
  });

  it('never fires in edit mode or mid-save', () => {
    expect(canAdoptExistingClient(clientFormFromClient(stored))).toBe(false);
    const saving = clientFormFromClient(null);
    saving.values.name = 'Boh Bros';
    saving.saving = true;
    expect(canAdoptExistingClient(saving)).toBe(false);
  });

  it('adoption prefills every field and switches to an id-carrying edit', () => {
    const blank = clientFormFromClient(null);
    blank.values.name = 'boh bros';
    const adopted = adoptExistingClient(blank, stored);
    expect(adopted.mode).toBe('edit');
    expect(adopted.values.id).toBe(42);
    expect(adopted.values.name).toBe('Boh Bros'); // canonical casing wins
    expect(adopted.values.address).toBe('55 Office Park Dr');
    expect(adopted.values.notes).toBe('net 30');
  });


  it('detaching returns a clean create draft carrying only the typed name', () => {
    const detached = detachToNewClientDraft('Boh Bros Marine');
    expect(detached.mode).toBe('create');
    expect(detached.values.id).toBeUndefined();
    expect(detached.values.name).toBe('Boh Bros Marine');
    expect(detached.values.address).toBe('');
    expect(detached.originalClient).toBeNull();
  });

  it('refuses to adopt over a dirty draft', () => {
    const dirty = clientFormFromClient(null);
    dirty.values.name = 'Boh Bros';
    dirty.values.address = 'half-typed address';
    expect(adoptExistingClient(dirty, stored)).toBe(dirty);
  });
});
