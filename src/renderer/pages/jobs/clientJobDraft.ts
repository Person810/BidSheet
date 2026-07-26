import type {
  ClientRow,
  SaveJobPayload,
} from '../../../shared/types/ipc';

export interface JobClientDraft {
  name: string;
  clientName: string;
  clientId: number | null;
  jobNumber: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  notes: string;
  location: string;
  bidDate: string;
  description: string;
  freight: number;
}

export interface NewJobDefaults {
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  taxPercent: number;
}

export interface ClientAddTransition {
  mode: 'add';
  draft: JobClientDraft;
}

export function createEmptyJobDraft(): JobClientDraft {
  return {
    name: '',
    clientName: '',
    clientId: null,
    jobNumber: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    notes: '',
    location: '',
    bidDate: '',
    description: '',
    freight: 0,
  };
}

function editable(value: string | null | undefined): string {
  return value ?? '';
}

export function applyClientToJobDraft(
  draft: JobClientDraft,
  client: ClientRow,
): JobClientDraft {
  return {
    ...draft,
    clientId: client.id,
    clientName: client.name,
    contactName: editable(client.contact_name),
    contactEmail: editable(client.contact_email),
    contactPhone: editable(client.contact_phone),
    address: editable(client.address),
    notes: editable(client.notes),
  };
}

export function clearClientSelection(draft: JobClientDraft): JobClientDraft {
  return {
    ...draft,
    clientId: null,
  };
}

export function beginClientAdd(draft: JobClientDraft): ClientAddTransition {
  return {
    mode: 'add',
    draft: { ...draft },
  };
}

export function completeClientAdd(
  transition: ClientAddTransition,
  createdClient: ClientRow,
): JobClientDraft {
  return applyClientToJobDraft(transition.draft, createdClient);
}

export function cancelClientAdd(transition: ClientAddTransition): JobClientDraft {
  return { ...transition.draft };
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function buildJobSavePayload(
  draft: JobClientDraft,
  defaults: NewJobDefaults,
): SaveJobPayload & { clientId?: number | null; freight?: number } {
  return {
    name: draft.name.trim(),
    client: draft.clientName.trim(),
    clientId: draft.clientId,
    jobNumber: optional(draft.jobNumber),
    location: optional(draft.location),
    bidDate: optional(draft.bidDate),
    startDate: null,
    description: optional(draft.description),
    status: 'draft',
    overheadPercent: defaults.overheadPercent,
    profitPercent: defaults.profitPercent,
    bondPercent: defaults.bondPercent,
    taxPercent: defaults.taxPercent,
    escalationPercent: 0,
    freight: draft.freight,
  };
}
