import { describe, expect, it } from 'vitest';
import type { JobRow } from '../../../shared/types/ipc';

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 41,
    name: 'Legacy rail project',
    job_number: 'JOB-0041',
    client: 'Example Client',
    client_id: 17,
    location: '  Exact legacy Location — 世界  ',
    bid_date: '2026-07-08',
    start_date: '2026-08-09',
    description: 'Existing description',
    status: 'submitted',
    overhead_percent: 12.5,
    profit_percent: 8.25,
    bond_percent: 1.5,
    tax_percent: 10,
    escalation_percent: 3.75,
    notes: 'Commercial note',
    bid_locked: 1,
    parent_job_id: 9,
    change_order_number: 2,
    created_at: '2026-01-02 03:04:05',
    updated_at: '2026-06-07 08:09:10',
    ...overrides,
  };
}

describe('job edit form mapping', () => {
  it('initializes every editable field including independent site and client state', async () => {
    const { jobRowToEditForm } = await import('./jobEditForm');

    expect(jobRowToEditForm(jobRow())).toEqual({
      name: 'Legacy rail project',
      jobNumber: 'JOB-0041',
      client: 'Example Client',
      selectedClientId: 17,
      location: '  Exact legacy Location — 世界  ',
      bidDate: '2026-07-08',
      description: 'Existing description',
      overheadPercent: 12.5,
      profitPercent: 8.25,
      bondPercent: 1.5,
      taxPercent: 10,
      escalationPercent: 3.75,
      freight: 0,
    });
  });

  it('maps nullable row values to controlled blank fields and numeric zeroes', async () => {
    const { jobRowToEditForm } = await import('./jobEditForm');

    expect(jobRowToEditForm(jobRow({
      job_number: null,
      client: '',
      client_id: null,
      location: null,
      bid_date: null,
      description: null,
      overhead_percent: 0,
      profit_percent: 0,
      bond_percent: null,
      tax_percent: null,
      escalation_percent: 0,
    }))).toEqual({
      name: 'Legacy rail project',
      jobNumber: '',
      client: '',
      selectedClientId: null,
      location: '',
      bidDate: '',
      description: '',
      overheadPercent: 0,
      profitPercent: 0,
      bondPercent: 0,
      taxPercent: 0,
      escalationPercent: 0,
      freight: 0,
    });
  });

  it('builds a complete save payload while preserving non-form job fields', async () => {
    const {
      buildEditJobSavePayload,
      jobRowToEditForm,
    } = await import('./jobEditForm');
    const job = jobRow();
    const form = {
      ...jobRowToEditForm(job),
      name: '  Updated project  ',
      client: 'Updated Client',
      selectedClientId: 23,
      location: 'Edited site display',
      bidDate: '2027-01-02',
      description: 'Updated description',
      overheadPercent: 11,
      profitPercent: 7,
      bondPercent: 2,
      taxPercent: 9,
      escalationPercent: 4,
      freight: 0,
    };

    expect(buildEditJobSavePayload(job, form)).toEqual({
      id: 41,
      name: 'Updated project',
      jobNumber: 'JOB-0041',
      client: 'Updated Client',
      clientId: 23,
      location: 'Edited site display',
      bidDate: '2027-01-02',
      startDate: '2026-08-09',
      description: 'Updated description',
      status: 'submitted',
      overheadPercent: 11,
      profitPercent: 7,
      bondPercent: 2,
      taxPercent: 9,
      escalationPercent: 4,
      freight: 0,
      notes: 'Commercial note',
      bidLocked: true,
      parentJobId: 9,
      changeOrderNumber: 2,
    });
  });

  it('normalizes cleared optional edit fields to null without changing client selection', async () => {
    const {
      buildEditJobSavePayload,
      jobRowToEditForm,
    } = await import('./jobEditForm');
    const job = jobRow();
    const form = {
      ...jobRowToEditForm(job),
      selectedClientId: 17,
      location: '',
      bidDate: '',
      description: '',
    };

    expect(buildEditJobSavePayload(job, form)).toMatchObject({
      client: 'Example Client',
      clientId: 17,
      location: null,
      bidDate: null,
      description: null,
    });
  });

  it('round-trips an unchanged legacy Location exactly', async () => {
    const {
      buildEditJobSavePayload,
      jobRowToEditForm,
    } = await import('./jobEditForm');
    const legacy = jobRow({
      location: '  Free text / keep punctuation exactly — 東京  ',
    });
    const form = jobRowToEditForm(legacy);

    expect(form).toMatchObject({
      location: '  Free text / keep punctuation exactly — 東京  ',
    });
    expect(buildEditJobSavePayload(legacy, form)).toMatchObject({
      location: '  Free text / keep punctuation exactly — 東京  ',
    });
  });
});
