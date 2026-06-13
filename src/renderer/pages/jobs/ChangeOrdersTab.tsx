import React from 'react';
import { formatCurrency, statusBadge } from './helpers';

interface ChangeOrdersTabProps {
  changeOrders: any[];
  coSummaries: Record<number, any>;
  onOpenJob: (id: number) => void;
  onCreateCO: () => void;
  /** Caller handles lock check + delete confirmation. */
  onDeleteCO: (co: any) => void;
}

/** Change-orders list + totals, extracted from JobDetail's "Changes" tab. */
export function ChangeOrdersTab({
  changeOrders, coSummaries, onOpenJob, onCreateCO, onDeleteCO,
}: ChangeOrdersTabProps) {
  return (
    <div className="card mb-24">
      <div className="flex justify-between items-center mb-16">
        <h3 style={{ fontSize: 15 }}>Change Orders</h3>
        <button className="btn btn-sm btn-primary no-print" onClick={onCreateCO}>+ Change Order</button>
      </div>

      {changeOrders.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13 }}>No change orders. Click "+ Change Order" to create one.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>CO #</th>
              <th>Description</th>
              <th>Status</th>
              <th className="text-right">Direct Cost</th>
              <th className="text-right">Total</th>
              <th className="no-print" style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {changeOrders.map((co) => {
              const coSum = coSummaries[co.id];
              return (
                <tr key={co.id}>
                  <td>
                    <span className="badge badge-submitted" style={{ fontSize: 11 }}>#{co.change_order_number}</span>
                  </td>
                  <td>
                    <span className="material-name-link no-print" onClick={() => onOpenJob(co.id)}>{co.name}</span>
                    <span className="print-only">{co.name}</span>
                  </td>
                  <td>{statusBadge(co.status)}</td>
                  <td className="text-right">{coSum ? formatCurrency(coSum.direct_cost_total) : '--'}</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{coSum ? formatCurrency(coSum.grandTotal) : '--'}</td>
                  <td className="no-print">
                    <div className="flex gap-8">
                      <button className="btn btn-sm btn-secondary" onClick={() => onOpenJob(co.id)}>Open</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => onDeleteCO(co)}>&times;</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={4} className="text-right" style={{ fontWeight: 600 }}>COs Total</td>
              <td className="text-right" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                {formatCurrency(changeOrders.reduce((s, co) => s + (coSummaries[co.id]?.grandTotal || 0), 0))}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
