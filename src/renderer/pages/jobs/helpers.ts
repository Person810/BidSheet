import React from 'react';

export function statusBadge(status: string) {
  const classes: Record<string, string> = {
    draft: 'badge-draft',
    submitted: 'badge-submitted',
    won: 'badge-won',
    lost: 'badge-lost',
    archived: 'badge-draft',
  };
  return React.createElement('span', { className: `badge ${classes[status] || 'badge-draft'}` }, status);
}

export function emptyLineForm() {
  return {
    description: '',
    itemNumber: '',
    costCode: '',
    quantity: 0,
    unit: 'LF',
    materialId: 0,
    materialUnitCost: 0,
    crewTemplateId: 0,
    productionRateId: 0,
    laborHours: 0,
    laborCostPerHour: 0,
    equipmentId: 0,
    equipmentHours: 0,
    equipmentCostPerHour: 0,
    subcontractorCost: 0,
    notes: '',
  };
}

/**
 * Parse a quantity cell from an owner's bid schedule: strips commas and
 * trailing units ("1,250 LF" → 1250). Returns 0 for unparseable values so
 * imported rows stay editable rather than failing.
 */
export function parseImportQuantity(raw: string | undefined | null): number {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!cleaned) return 0;
  const n = parseFloat(cleaned[0]);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function jobToPayload(job: any) {
  return {
    id: job.id, name: job.name, jobNumber: job.job_number, client: job.client,
    location: job.location, bidDate: job.bid_date, startDate: job.start_date,
    description: job.description, status: job.status, overheadPercent: job.overhead_percent,
    profitPercent: job.profit_percent, bondPercent: job.bond_percent,
    taxPercent: job.tax_percent, escalationPercent: job.escalation_percent ?? 0,
    notes: job.notes, bidLocked: job.bid_locked === 1,
    parentJobId: job.parent_job_id || null, changeOrderNumber: job.change_order_number || null,
  };
}

export function formatCurrency(val: number | null | undefined, opts?: { maximumFractionDigits?: number }) {
  if (val == null) return '--';
  return (val ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', ...opts });
}

/** Parse a YYYY-MM-DD date string without timezone shift. */
export function formatDateLocal(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(+match[1], +match[2] - 1, +match[3]).toLocaleDateString();
  }
  return new Date(dateStr).toLocaleDateString();
}
