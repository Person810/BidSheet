import React, { useState, useRef, useEffect } from 'react';
import { formatCurrency } from './helpers';
import { PriceStateDot } from './priceState';
import { CalcPopover } from '../../components/CalcPopover';
import { explainSum, explainQuotient, fmtMoney, fmtQty } from '../../../shared/calcExplain';
import { explainDirectCost, explainEscalation, explainMarkup, explainGrandTotal } from '../../../shared/bidCalc';
import { parseManualFields, MANUAL_FIELD_LABELS, type OverridableField } from '../../../shared/manualFields';

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
  /** Commit an inline cell edit (quantity or material unit cost). */
  onCommitInlineEdit: (item: any, changes: { quantity?: number; materialUnitCost?: number }) => void;
  hasAssemblies: boolean;
  approvedCOTotal: number;
  revisedTotal: number;
  isChangeOrder: boolean;
  /** material_id → catalog price age in days, for stale-price warnings */
  materialAges?: Map<number, number | null>;
}

const COL_COUNT = 9;

type EditField = 'quantity' | 'materialUnitCost';
const FIELDS: EditField[] = ['quantity', 'materialUnitCost'];

function sectionTotals(items: any[]) {
  return {
    material: items.reduce((s, i) => s + (i.material_total || 0), 0),
    labor: items.reduce((s, i) => s + (i.labor_total || 0), 0),
    equipment: items.reduce((s, i) => s + (i.equipment_total || 0), 0),
    total: items.reduce((s, i) => s + (i.total_cost || 0), 0),
  };
}

function fieldValue(item: any, field: EditField): number {
  return field === 'quantity' ? item.quantity : item.material_unit_cost;
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
  onCommitInlineEdit,
  hasAssemblies,
  approvedCOTotal,
  revisedTotal,
  isChangeOrder,
  materialAges,
}: BidGridProps) {
  // ---- Inline cell editing ----
  // One cell edits at a time (spreadsheet-style). `editing` holds the target
  // cell by line-item id + field; `draft` is the in-progress text value.
  const [editing, setEditing] = useState<{ id: number; field: EditField } | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // True while we move focus between cells, so the input's blur handler
  // doesn't fire a spurious commit that would cancel the navigation.
  const navigating = useRef(false);
  // Locked bids keep the modal flow (which warns before editing); inline
  // editing is only wired up when the bid is freely editable.
  const inlineEnabled = !isLocked;

  // Flat, display-ordered list of editable line items + their cells, used to
  // resolve Tab/Enter/Arrow navigation to the adjacent cell.
  const editableItems: any[] = [];
  for (const section of sections) {
    for (const item of lineItems[section.id] || []) editableItems.push(item);
  }
  const cellList: { id: number; field: EditField }[] = [];
  for (const item of editableItems) {
    for (const field of FIELDS) cellList.push({ id: item.id, field });
  }

  // Focus + select the active input whenever the edited cell changes, and
  // clear the navigation guard once the move has settled.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    navigating.current = false;
  }, [editing]);

  const isEditing = (id: number, field: EditField) => editing?.id === id && editing?.field === field;

  const beginEdit = (item: any, field: EditField) => {
    if (!inlineEnabled) return;
    setEditing({ id: item.id, field });
    setDraft(String(fieldValue(item, field)));
  };

  const moveTo = (target: { id: number; field: EditField } | null) => {
    if (!target) {
      setEditing(null);
      setDraft('');
      return;
    }
    setEditing(target);
    const it = editableItems.find((i) => i.id === target.id);
    setDraft(it ? String(fieldValue(it, target.field)) : '');
  };

  const neighbor = (direction: 'next' | 'prev' | 'up' | 'down') => {
    if (!editing) return null;
    if (direction === 'next' || direction === 'prev') {
      const idx = cellList.findIndex((c) => c.id === editing.id && c.field === editing.field);
      if (idx < 0) return null;
      return cellList[direction === 'next' ? idx + 1 : idx - 1] || null;
    }
    // up/down: stay in the same column, step one line item.
    const ii = editableItems.findIndex((i) => i.id === editing.id);
    if (ii < 0) return null;
    const nit = editableItems[direction === 'down' ? ii + 1 : ii - 1];
    return nit ? { id: nit.id, field: editing.field } : null;
  };

  // Save the draft (if it parsed to a new, valid value) then move to the next
  // cell — or exit editing when there's no move target.
  const commit = (move: 'next' | 'prev' | 'up' | 'down' | null) => {
    if (!editing) return;
    const item = editableItems.find((i) => i.id === editing.id);
    const parsed = parseFloat(draft);
    if (item && Number.isFinite(parsed) && parsed >= 0 && parsed !== fieldValue(item, editing.field)) {
      onCommitInlineEdit(
        item,
        editing.field === 'quantity' ? { quantity: parsed } : { materialUnitCost: parsed },
      );
    }
    moveTo(move ? neighbor(move) : null);
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        navigating.current = true;
        commit(e.shiftKey ? 'up' : 'down');
        break;
      case 'Tab':
        e.preventDefault();
        navigating.current = true;
        commit(e.shiftKey ? 'prev' : 'next');
        break;
      case 'ArrowDown':
        e.preventDefault();
        navigating.current = true;
        commit('down');
        break;
      case 'ArrowUp':
        e.preventDefault();
        navigating.current = true;
        commit('up');
        break;
      case 'Escape':
        e.preventDefault();
        setEditing(null);
        setDraft('');
        break;
      default:
        break;
    }
  };

  const renderInput = () => (
    <input
      ref={inputRef}
      className="bid-grid-cell-input"
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onCellKeyDown}
      onBlur={() => { if (!navigating.current) commit(null); }}
    />
  );

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
                    }} title="Bid alternate: priced separately, excluded from base bid total">ALT</span>
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
                      <PriceStateDot state={item.price_state} source={item.price_source}
                        ageDays={item.material_id ? materialAges?.get(item.material_id) : null} />
                      {item.item_number && (
                        <span className="text-muted" style={{ marginRight: 6, fontSize: 11 }}>
                          {item.item_number}
                        </span>
                      )}
                      <span className="material-name-link no-print" onClick={() => onEditLineItem(item)}>
                        {item.description}
                      </span>
                      <span className="print-only">{item.description}</span>
                      {(() => {
                        const mf = parseManualFields(item.manual_fields);
                        return mf.length > 0 ? (
                          <span className="manual-marker no-print"
                            title={`Manual override: ${mf.map((f) => MANUAL_FIELD_LABELS[f as OverridableField]).join(', ')}`}>
                            ✎
                          </span>
                        ) : null;
                      })()}
                      {item.cost_code && (
                        <span className="text-muted no-print" style={{ marginLeft: 6, fontSize: 10 }}
                          title="Cost code">
                          [{item.cost_code}]
                        </span>
                      )}
                    </td>

                    {/* Quantity — inline editable */}
                    {inlineEnabled && isEditing(item.id, 'quantity') ? (
                      <td className="text-right" style={{ padding: 0 }}>{renderInput()}</td>
                    ) : inlineEnabled ? (
                      <td className="text-right bid-grid-editable" title="Click to edit quantity"
                        onClick={() => beginEdit(item, 'quantity')}>{item.quantity}</td>
                    ) : (
                      <td className="text-right">{item.quantity}</td>
                    )}

                    <td>{item.unit}</td>

                    {/* Material — inline editable. Edits the material unit price;
                        the cell shows the extended total with the unit price
                        beneath it (the @-price hint is screen-only). */}
                    {inlineEnabled && isEditing(item.id, 'materialUnitCost') ? (
                      <td className="text-right" style={{ padding: 0 }}>{renderInput()}</td>
                    ) : inlineEnabled ? (
                      <td className="text-right bid-grid-editable" title="Click to edit material unit price"
                        onClick={() => beginEdit(item, 'materialUnitCost')}>
                        {formatCurrency(item.material_total)}
                        {item.material_unit_cost > 0 && (
                          <div className="bid-grid-unit-cost no-print">@ {formatCurrency(item.material_unit_cost)}</div>
                        )}
                      </td>
                    ) : (
                      <td className="text-right">{formatCurrency(item.material_total)}</td>
                    )}

                    <td className="text-right">{formatCurrency(item.labor_total)}</td>
                    <td className="text-right">{formatCurrency(item.equipment_total)}</td>
                    <td className="text-right" style={{ fontWeight: 600 }}>
                      {formatCurrency(item.total_cost)}
                      <CalcPopover ariaLabel="Show line total math" breakdown={explainSum(
                        'Line total = material + labor + equipment + subcontractor',
                        [
                          { label: 'Material', value: fmtMoney(item.material_total || 0) },
                          { label: 'Labor', value: fmtMoney(item.labor_total || 0) },
                          { label: 'Equipment', value: fmtMoney(item.equipment_total || 0) },
                          { label: 'Subcontractor', value: fmtMoney(item.subcontractor_cost || 0) },
                        ],
                        { label: 'Line total', value: fmtMoney(item.total_cost || 0) },
                      )} />
                    </td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>
                      {item.quantity > 0 ? formatCurrency(item.unit_cost) : '--'}
                      {item.quantity > 0 && (
                        <CalcPopover ariaLabel="Show $/unit math" breakdown={explainQuotient(
                          '$/Unit = line total ÷ quantity',
                          { label: 'Line total', value: fmtMoney(item.total_cost || 0) },
                          { label: 'Quantity', value: fmtQty(item.quantity, item.unit) },
                          { label: '$/Unit', value: `${fmtMoney(item.unit_cost || 0)}/${item.unit}` },
                        )} />
                      )}
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
            <td className="text-right" style={{ fontWeight: 700 }}>
              {formatCurrency(summary.direct_cost_total)}
              <CalcPopover ariaLabel="Show direct cost math" breakdown={explainDirectCost(summary)} />
            </td>
            <td colSpan={2}></td>
          </tr>
          {/* Material escalation (conditional) */}
          {summary.escalation > 0 && (
            <tr>
              <td colSpan={6} className="text-right">Material Escalation ({job.escalation_percent}%)</td>
              <td className="text-right">
                {formatCurrency(summary.escalation)}
                <CalcPopover ariaLabel="Show escalation math" breakdown={explainEscalation(summary, job.escalation_percent)} />
              </td>
              <td colSpan={2}></td>
            </tr>
          )}
          {/* Overhead */}
          <tr>
            <td colSpan={6} className="text-right">Overhead{hasMarkupOverrides ? '*' : ` (${job.overhead_percent}%)`}</td>
            <td className="text-right">
              {formatCurrency(summary.overhead)}
              <CalcPopover ariaLabel="Show overhead math" breakdown={explainMarkup('overhead', summary, hasMarkupOverrides)} />
            </td>
            <td colSpan={2}></td>
          </tr>
          {/* Profit */}
          <tr>
            <td colSpan={6} className="text-right">Profit{hasMarkupOverrides ? '*' : ` (${job.profit_percent}%)`}</td>
            <td className="text-right">
              {formatCurrency(summary.profit)}
              <CalcPopover ariaLabel="Show profit math" breakdown={explainMarkup('profit', summary, hasMarkupOverrides)} />
            </td>
            <td colSpan={2}></td>
          </tr>
          {/* Bond (conditional) */}
          {summary.bond > 0 && (
            <tr>
              <td colSpan={6} className="text-right">Bond{hasMarkupOverrides ? '*' : ` (${job.bond_percent}%)`}</td>
              <td className="text-right">
                {formatCurrency(summary.bond)}
                <CalcPopover ariaLabel="Show bond math" breakdown={explainMarkup('bond', summary, hasMarkupOverrides)} />
              </td>
              <td colSpan={2}></td>
            </tr>
          )}
          {/* Tax (conditional) */}
          {summary.tax > 0 && (
            <tr>
              <td colSpan={6} className="text-right">Sales Tax ({job.tax_percent}%)</td>
              <td className="text-right">
                {formatCurrency(summary.tax)}
                <CalcPopover ariaLabel="Show sales tax math" breakdown={explainMarkup('tax', summary, false)} />
              </td>
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
              <CalcPopover ariaLabel="Show bid total math" breakdown={explainGrandTotal(summary)} />
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
