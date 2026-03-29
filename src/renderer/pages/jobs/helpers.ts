export function emptyLineForm() {
  return {
    description: '',
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

export function jobToPayload(job: any) {
  return {
    id: job.id, name: job.name, jobNumber: job.job_number, client: job.client,
    location: job.location, bidDate: job.bid_date, startDate: job.start_date,
    description: job.description, status: job.status, overheadPercent: job.overhead_percent,
    profitPercent: job.profit_percent, bondPercent: job.bond_percent,
    taxPercent: job.tax_percent, notes: job.notes, bidLocked: job.bid_locked === 1,
    parentJobId: job.parent_job_id || null, changeOrderNumber: job.change_order_number || null,
  };
}

export function formatCurrency(val: number) {
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
