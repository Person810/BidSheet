import { describe, expect, it } from 'vitest';

import type { ClientRow } from '../../../shared/types/ipc';
import {
  applyClientToJobDraft,
  beginClientAdd,
  buildJobSavePayload,
  cancelClientAdd,
  clearClientSelection,
  completeClientAdd,
  createEmptyJobDraft,
} from './clientJobDraft';

const client: ClientRow = {
  id: 42,
  name: 'Acme Rail',
  contact_name: 'Ada Signal',
  contact_email: 'ada@acme.example',
  contact_phone: '+61 8 5555 0100',
  address: '10 Track Street, Adelaide',
  notes: 'Master-only note',
  is_active: 1,
  uuid: 'abc-123',
  created_at: '2026-07-17 10:00:00',
  updated_at: '2026-07-17 10:00:00',
};

describe('client-to-job draft mapping', () => {
  it('initializes independent project-site fields as editable blank text', () => {
    expect(createEmptyJobDraft()).toMatchObject({
      location: '',
    });
  });

  it('copies the selected identity and client snapshot fields', () => {
    const draft = {
      ...createEmptyJobDraft(),
      name: 'Signal Upgrade',
      description: 'Existing draft description',
    };

    expect(applyClientToJobDraft(draft, client)).toEqual({
      ...draft,
      clientId: 42,
      clientName: 'Acme Rail',
      contactName: 'Ada Signal',
      contactEmail: 'ada@acme.example',
      contactPhone: '+61 8 5555 0100',
      address: '10 Track Street, Adelaide',
      notes: 'Master-only note',
    });
  });

  it('does not populate or overwrite the independent project/site location', () => {
    const withSite = {
      ...createEmptyJobDraft(),
      location: 'Bowmans Intermodal Site, SA',
    };
    const selected = applyClientToJobDraft(withSite, client);
    const withoutSite = applyClientToJobDraft(createEmptyJobDraft(), client);

    expect(selected.location).toBe('Bowmans Intermodal Site, SA');
    expect(withoutSite.location).toBe('');
    expect(selected.location).not.toContain(client.address!);
  });

  it('maps nullable client values to blank editable draft text', () => {
    const minimalClient: ClientRow = {
      ...client,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      address: null,
      notes: null,
    };

    expect(applyClientToJobDraft(createEmptyJobDraft(), minimalClient)).toMatchObject({
      clientId: minimalClient.id,
      clientName: minimalClient.name,
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      address: '',
      notes: '',
    });
  });
});

describe('manual entry and clearing selection', () => {
  it('keeps manual free-text client entry unassociated', () => {
    const draft = {
      ...createEmptyJobDraft(),
      clientName: 'One-off client typed by user',
      location: 'Project site typed by user',
    };

    expect(draft).toMatchObject({
      clientId: null,
      clientName: 'One-off client typed by user',
      location: 'Project site typed by user',
    });
  });

  it('clears only the reusable association and retains current draft text', () => {
    const selected = applyClientToJobDraft({
      ...createEmptyJobDraft(),
      name: 'Unrelated job name',
      location: 'Unrelated project site',
    }, client);

    expect(clearClientSelection(selected)).toEqual({
      ...selected,
      clientId: null,
    });
  });

  it('allows retained client text to be deliberately edited after clearing', () => {
    const selected = applyClientToJobDraft(createEmptyJobDraft(), client);
    const cleared = clearClientSelection(selected);
    const manuallyEdited = { ...cleared, clientName: 'Acme Rail — one-off division' };

    expect(manuallyEdited.clientId).toBeNull();
    expect(manuallyEdited.clientName).toBe('Acme Rail — one-off division');
  });
});

describe('job save payload mapping', () => {
  it('emits the selected client association and exact current snapshot', () => {
    const draft = applyClientToJobDraft({
      ...createEmptyJobDraft(),
      name: 'Signal Upgrade',
      location: 'Bowmans Site',
      bidDate: '2026-08-01',
      description: 'Install equipment',
    }, client);

    expect(buildJobSavePayload(draft, {
      overheadPercent: 12,
      profitPercent: 8,
      bondPercent: 1,
      taxPercent: 10,
    })).toEqual({
      name: 'Signal Upgrade',
      client: 'Acme Rail',
      clientId: 42,
      location: 'Bowmans Site',
      bidDate: '2026-08-01',
      startDate: null,
      description: 'Install equipment',
      status: 'draft',
      overheadPercent: 12,
      profitPercent: 8,
      bondPercent: 1,
      taxPercent: 10,
      escalationPercent: 0,
      freight: 0,
      jobNumber: null,
    });
  });

  it('emits a compatible unlinked payload for manual client text', () => {
    const draft = {
      ...createEmptyJobDraft(),
      name: 'Manual Job',
      clientName: 'Casual Customer',
      location: '',
    };

    expect(buildJobSavePayload(draft, {
      overheadPercent: 10,
      profitPercent: 10,
      bondPercent: 0,
      taxPercent: 0,
    })).toMatchObject({
      name: 'Manual Job',
      client: 'Casual Customer',
      clientId: null,
      location: null,
      jobNumber: null,
    });
  });

  it('uses null for blank optional draft fields without changing visible text state', () => {
    const draft = {
      ...createEmptyJobDraft(),
      name: '  Trimmed Job  ',
      clientName: '  Manual Client  ',
      description: '',
    };
    const before = structuredClone(draft);
    const payload = buildJobSavePayload(draft, {
      overheadPercent: 10,
      profitPercent: 10,
      bondPercent: 0,
      taxPercent: 0,
    });

    expect(payload).toMatchObject({
      name: 'Trimmed Job',
      client: 'Manual Client',
      description: null,
      jobNumber: null,
    });
    expect(draft).toEqual(before);
  });
});

describe('inline client add transitions', () => {
  const populatedDraft = {
    ...createEmptyJobDraft(),
    name: 'Preserved Job Name',
    clientName: 'Unsaved manual text',
    location: 'Bowmans Project Site',
    bidDate: '2026-09-01',
    description: 'Draft work description',
  };

  it('opens add mode without changing or sharing a mutable draft', () => {
    const before = structuredClone(populatedDraft);
    const transition = beginClientAdd(populatedDraft);

    expect(transition.mode).toBe('add');
    expect(transition.draft).toEqual(before);
    expect(transition.draft).not.toBe(populatedDraft);
    expect(populatedDraft).toEqual(before);
  });

  it('selects and snapshots a successfully created client while preserving unrelated fields', () => {
    const transition = beginClientAdd(populatedDraft);
    const createdClient = {
      ...client,
      id: 84,
      name: 'Newly Saved Client',
      contact_name: 'New Contact',
    };

    expect(completeClientAdd(transition, createdClient)).toEqual({
      ...populatedDraft,
      clientId: 84,
      clientName: 'Newly Saved Client',
      contactName: 'New Contact',
      contactEmail: createdClient.contact_email,
      contactPhone: createdClient.contact_phone,
      address: createdClient.address,
      notes: createdClient.notes,
    });
  });

  it('cancels add mode with the complete original job draft unchanged', () => {
    const before = structuredClone(populatedDraft);
    const transition = beginClientAdd(populatedDraft);

    expect(cancelClientAdd(transition)).toEqual(before);
    expect(populatedDraft).toEqual(before);
  });

  it('does not mutate the saved transition snapshot when external draft data changes', () => {
    const mutableDraft = { ...populatedDraft };
    const transition = beginClientAdd(mutableDraft);
    mutableDraft.name = 'Changed outside transition';
    mutableDraft.location = 'Changed site';

    expect(cancelClientAdd(transition)).toMatchObject({
      name: 'Preserved Job Name',
      location: 'Bowmans Project Site',
    });
  });
});
