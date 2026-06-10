import React from 'react';
import { formatCurrency } from './helpers';

interface BidGridProps {
  sections: any[];
  lineItems: Record<number, any[]>;
  summary: any | null;
  job: any;
  isLocked: boolean;
  onAddLineItem: (sectionId: number) => void;
  onEditLineItem: (item: any) => void;
  onDeleteLineItem: (id: number) => void;
  onDeleteSection: (id: number) => void;
  onEditSection: (section: any) => void;
  onOpenAssemblyPicker: (sectionId: number) => void;
  hasAssemblies: boolean;
  approvedCOTotal: number;
  revisedTotal: number;
  isChangeOrder: boolean;
}

const COL_COUNT = 9;

function sectionTotals(items: any[]) {
  return {
    material: items.reduce((s, i) => s + (i.material_total || 0), 0),
    labor: items.reduce((s, i) => s + (i.labor_total || 0), 0),
    equipment: items.reduce((s, i) => s + (i.equipment_total || 0), 0),
    total: items.reduce((s, i) => s + (i.total_cost || 0), 0),
  };
}

export function BidGrid({
  sections,
  lineItems,
  summary,
  job,
  isLocked,
  onAddLineItem,
  onEditLineItem,
  onDeleteLineItem,
  onDeleteSection,
  onEditSection,
  onOpenAssemblyPicker,
  hasAssemblies,
  approvedCOTotal,
  revisedTotal,
  isChangeOrder,
}: BidGridProps) {
  if (sections.length === 0) {
    return (
      <div className="card mb-24" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        No bid sections yet. Add a section to start building your estimate.
      </div>
    );
  }

  // When any non-alternate section overrides job markups, percent labels in
  // the footer would be misleading — show a * instead
  const hasMarkupOverrides = sections.some((s) => s.is_alternate !== 1 && (
    s.overhead_percent_override != null
    || s.profit_percent_override != null
    || s.bond_percent_override != null
  ));

  return (
    <table className="data-table bid-grid">
      <colgroup>
        <col style={{ width: '32%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '5%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '9%' }} />
        <col style={{ width: '3%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>Description</th>
          <th className="text-right">Qty</th>
          <th>Unit</th>
          <th className="text-right">Material</th>
          <th className="text-right">Labor</th>
          <th className="text-right">Equipment</th>
          <th className="text-right">Total</th>
          <th className="text-right">$/Unit</th>
          <th className="no-print"></th>
        </tr>
      </thead>
      <tbody>
        {sections.map((section) => {
          const items = lineItems[section.id] || [];
          const totals = sectionTotals(items);
          return (
            <React.Fragment key={section.id}>
              {/* Section header row */}
              <tr className="bid-grid-section-row">
                <td colSpan={3}>
                  {section.name}
                  {section.is_alternate === 1 && (
                    <span style={{
                      marginLeft: 8, padding: '1px 6px', borderRadius: 3, fontSize: 10,
                      fontWeight: 700, background: 'rgba(232,160,32,0.18)', color: '#d97706',
                      verticalAlign: 'middle',
                    }} title="Bid alternate — priced separately, excluded from base bid total">ALT</span>
                  )}
                  {(section.overhead_percent_override != null
                    || section.profit_percent_override != null
                    || section.bond_percent_override != null) && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)', verticalAlign: 'middle' }}
                      title={`Markup overrides: OH ${section.overhead_percent_override ?? job.overhead_percent}% / Profit ${section.profit_percent_override ?? job.profit_percent}% / Bond ${section.bond_percent_override ?? job.bond_percent}%`}>
                      &#9881;%
                    </span>
                  )}
                  <button className="bid-grid-inline-action no-print" onClick={() => onAddLineItem(section.id)}>
                    + item
                  </button>
                  {hasAssemblies && (
                    <button className="bid-grid-inline-action no-print" onClick={() => onOpenAssemblyPicker(section.id)}>
                      + assembly
                    </button>
                  )}
                  <button className="bid-grid-inline-action no-print" onClick={() => onEditSection(section)}
                    title="Section settings (alternate, markup overrides)">
                    settings
                  </button>
                </td>
                <td className="text-right" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(totals.material)}</td>
                <td className="text-right" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(totals.labor)}</td>
                <td className="text-right" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(totals.equipment)}</td>
                <td className="text-right" style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(totals.total)}</td>
                <td></td>
                <td className="no-print">
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => onDeleteSection(section.id)}
                    title="Remove section"
                    style={{ fontSize: 11, padding: '1px 6px' }}
                  >
                    &#215;
                  </button>
                </td>
              </tr>

              {/* Line items or empty state */}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={COL_COUNT} className="bid-grid-item-desc" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No line items. Click + item to add one.
                  </td>
                </tr>
              ) : (
                items.map((item: any) => (
                  <tr key={item.id} className="bid-grid-item-row">
                    <td className="bid-grid-item-desc">
                      <span className="material-name-link no-print" onClick={() => onEditLineItem(item)}>
                        {item.description}
                      </span>
                      <span className="print-only">{item.description}</span>
                    </td>
                    <td className="text-right">{item.quantity}</td>
                    <td>{item.unit}</td>
                    <td className="text-right">{formatCurrency(item.material_total)}</td>
                    <td className="text-right">{formatCurrency(item.labor_total)}</td>
                    <td className="text-right">{formatCurrency(item.equipment_total)}</td>
                    <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(item.total_cost)}</td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>
                      {item.quantity > 0 ? formatCurrency(item.unit_cost) : '--'}
                    </td>
                    <td className="no-print">
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => onDeleteLineItem(item.id)}
                        style={{ fontSize: 11, padding: '1px 6px' }}
                      >
                        &#215;
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </React.Fragment>
          );
        })}
      </tbody>

      {/* Summary footer */}
      {summary && (
        <tfoot className="bid-grid-footer">
          {/* Direct cost row */}
          <tr>
            <td colSpan={3} className="text-right" style={{ fontWeight: 600 }}>Direct Cost</td>
            <td className="text-right">{formatCurrency(summary.material_total)}</td>
            <td className="text-right">{formatCurrency(summary.labor_total)}</td>
            <td className="text-right">{formatCurrency(summary.equipment_total)}</td>
            <td className="text-right" style={{ fontWeight: 700 }}>{formatCurrency(summary.direct_cost_total)}</td>
            <td colSpan={2}></td>
          </tr>
          {/* Overhead */}
          <tr>
            <td colSpan={6} className="text-right">Overhead{hasMarkupOverrides ? '*' : ` (${job.overhead_percent}%)`}</td>
            <td className="text-right">{formatCurrency(summary.overhead)}</td>
            <td colSpan={2}></td>
          </tr>
          {/* Profit */}
          <tr>
            <td colSpan={6} className="text-right">Profit{hasMarkupOverrides ? '*' : ` (${job.profit_percent}%)`}</td>
            <td className="text-right">{formatCurrency(summary.profit)}</td>
            <td colSpan={2}></td>
          </tr>
          {/* Bond (conditional) */}
          {summary.bond > 0 && (
            <tr>
              <td colSpan={6} className="text-right">Bond{hasMarkupOverrides ? '*' : ` (${job.bond_percent}%)`}</td>
              <td className="text-right">{formatCurrency(summary.bond)}</td>
              <td colSpan={2}></td>
            </tr>
          )}
          {/* Tax (conditional) */}
          {summary.tax > 0 && (
            <tr>
              <td colSpan={6} className="text-right">Sales Tax ({job.tax_percent}%)</td>
              <td className="text-right">{formatCurrency(summary.tax)}</td>
              <td colSpan={2}></td>
            </tr>
          )}
          {/* BID TOTAL */}
          <tr className="bid-grid-footer-total">
            <td colSpan={6} className="text-right" style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
              {isChangeOrder ? 'CO TOTAL' : (summary.alternates?.length > 0 ? 'BASE BID TOTAL' : 'BID TOTAL')}
            </td>
            <td className="text-right" style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
              {formatCurrency(summary.grandTotal)}
            </td>
            <td colSpan={2}></td>
          </tr>
          {/* Alternates (each priced separately with its own markups) */}
          {(summary.alternates || []).map((alt: any) => (
            <tr key={alt.sectionId}>
              <td colSpan={6} className="text-right" style={{ color: '#d97706' }}>
                Add Alternate: {alt.name}
              </td>
              <td className="text-right" style={{ fontWeight: 600, color: '#d97706' }}>
                {formatCurrency(alt.grandTotal)}
              </td>
              <td colSpan={2}></td>
            </tr>
          ))}
          {hasMarkupOverrides && (
            <tr>
              <td colSpan={9} className="text-right" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                * includes per-section markup overrides
              </td>
            </tr>
          )}
          {/* Revised total (parent jobs with approved COs) */}
          {!isChangeOrder && approvedCOTotal > 0 && (
            <tr>
              <td colSpan={6} className="text-right" style={{ fontWeight: 600, color: 'var(--success)' }}>
                Revised Total (Original + Approved COs)
              </td>
              <td className="text-right" style={{ fontWeight: 700, color: 'var(--success)' }}>
                {formatCurrency(revisedTotal)}
              </td>
              <td colSpan={2}></td>
            </tr>
          )}
        </tfoot>
      )}
    </table>
  );
}
