import type {
  JobRow,
  SaveJobPayload,
} from '../../../shared/types/ipc';
import type { EditJobForm } from './EditJobModal';

export interface JobEditFormState extends EditJobForm {
  selectedClientId: number | null;
  freight: number;
}

function editable(value: string | null): string {
  return value ?? '';
}

export function jobRowToEditForm(job: JobRow): JobEditFormState {
  return {
    name: job.name || '',
    jobNumber: job.job_number || '',
    client: job.client || '',
    selectedClientId: job.client_id ?? null,
    location: editable(job.location),
    bidDate: editable(job.bid_date),
    description: editable(job.description),
    overheadPercent: job.overhead_percent ?? 0,
    profitPercent: job.profit_percent ?? 0,
    bondPercent: job.bond_percent ?? 0,
    taxPercent: job.tax_percent ?? 0,
    escalationPercent: job.escalation_percent ?? 0,
    freight: (job as any).freight ?? 0, // In case freight isn't typed in JobRow yet
  };
}

export function buildEditJobSavePayload(
  job: JobRow,
  form: JobEditFormState,
): SaveJobPayload & { clientId?: number | null; freight?: number } {
  return {
    id: job.id,
    name: form.name.trim(),
    jobNumber: form.jobNumber || null,
    client: form.client || '',
    clientId: form.selectedClientId,
    location: form.location || null,
    bidDate: form.bidDate || null,
    startDate: job.start_date,
    description: form.description || null,
    status: job.status,
    overheadPercent: form.overheadPercent,
    profitPercent: form.profitPercent,
    bondPercent: form.bondPercent,
    taxPercent: form.taxPercent,
    escalationPercent: form.escalationPercent,
    freight: form.freight,
    notes: job.notes,
    bidLocked: job.bid_locked === 1,
    parentJobId: job.parent_job_id || null,
    changeOrderNumber: job.change_order_number || null,
  };
}
