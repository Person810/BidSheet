import React from 'react';
import type { PriceState } from '../../../shared/types/ipc';

/**
 * The price-state system (§4) — BidSheet's signature in-grid signal. Each
 * state maps to a semantic color (amber = unverified seed, green = confirmed)
 * and a one-line meaning surfaced as a tooltip. Kept deliberately quiet: a
 * small dot, not a loud badge.
 */
export const PRICE_STATE_META: Record<PriceState, { label: string; color: string; desc: string }> = {
  seed:       { label: 'Seed',       color: 'var(--warning)',    desc: 'Seed price, unverified placeholder' },
  past_price: { label: 'Past price', color: 'var(--text-muted)', desc: 'Past price: real, but not quoted for this job' },
  quoted:     { label: 'Quoted',     color: 'var(--accent)',     desc: 'Quoted for this job' },
  confirmed:  { label: 'Confirmed',  color: 'var(--success)',    desc: 'Confirmed price' },
};

const KNOWN: PriceState[] = ['seed', 'past_price', 'quoted', 'confirmed'];

export function asPriceState(value: string | null | undefined): PriceState {
  return value && (KNOWN as string[]).includes(value) ? (value as PriceState) : 'seed';
}

/**
 * Stale-price warning (§4 follow-on): a catalog price untouched for this
 * long gets flagged before the bid goes out. Duplicated jobs copy
 * price_state verbatim, so even a "confirmed" line can be riding on last
 * year's catalog price — staleness is judged on catalog age alone.
 */
export const STALE_PRICE_DAYS = 90;

/**
 * Whole days since a catalog timestamp (SQLite localtime format,
 * 'YYYY-MM-DD HH:MM:SS'). Unparseable/missing input → null (never stale).
 */
export function priceAgeDays(lastUpdate: string | null | undefined, now: Date = new Date()): number | null {
  if (!lastUpdate) return null;
  const t = new Date(lastUpdate.replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/**
 * Count line items whose material's catalog price is STALE_PRICE_DAYS or
 * older. Lines without a material (labor-only, subs) never count.
 */
export function countStaleLines(
  lineItems: Record<number, any[]>,
  materialAges: Map<number, number | null>,
): number {
  let stale = 0;
  for (const items of Object.values(lineItems)) {
    for (const it of items) {
      if (!it.material_id) continue;
      const age = materialAges.get(it.material_id);
      if (age != null && age >= STALE_PRICE_DAYS) stale++;
    }
  }
  return stale;
}

/**
 * The legend + payoff strip shown above the bid grid: a key for the dot
 * colors, plus the running "X of N on confirmed/quoted prices · M still on
 * seed" tally (§4). Hidden when the bid has no lines.
 */
export function PriceStateLegend({ lineItems, materialAges }: {
  lineItems: Record<number, any[]>;
  materialAges?: Map<number, number | null>;
}) {
  const counts: Record<PriceState, number> = { seed: 0, past_price: 0, quoted: 0, confirmed: 0 };
  let total = 0;
  for (const items of Object.values(lineItems)) {
    for (const it of items) {
      counts[asPriceState(it.price_state)]++;
      total++;
    }
  }
  if (total === 0) return null;

  const stale = materialAges ? countStaleLines(lineItems, materialAges) : 0;
  const live = counts.quoted + counts.confirmed;
  return (
    <div className="price-state-legend no-print">
      {KNOWN.map((s) => (
        counts[s] > 0 ? (
          <span key={s} className="legend-item" title={PRICE_STATE_META[s].desc}>
            <span className="price-state-dot" style={{ background: PRICE_STATE_META[s].color, margin: 0 }} />
            {counts[s]} {PRICE_STATE_META[s].label.toLowerCase()}
          </span>
        ) : null
      ))}
      <span className="legend-payoff">
        {live} of {total} on quoted prices
        {counts.seed > 0 ? ` · ${counts.seed} still on seed` : ''}
      </span>
      {stale > 0 && (
        <span className="legend-item" style={{ color: 'var(--warning)' }}
          title={`${stale} line${stale !== 1 ? 's' : ''} priced from catalog entries not updated in ${STALE_PRICE_DAYS}+ days. Check current pricing before submitting.`}>
          &#9888; {stale} stale price{stale !== 1 ? 's' : ''} ({STALE_PRICE_DAYS}+ days)
        </span>
      )}
    </div>
  );
}

/**
 * Small left-of-description state dot. `source` enriches the tooltip;
 * `ageDays` adds a quiet warning ring + tooltip when the backing catalog
 * price has gone stale.
 */
export function PriceStateDot({ state, source, ageDays }: {
  state: string | null | undefined;
  source?: string | null;
  ageDays?: number | null;
}) {
  const meta = PRICE_STATE_META[asPriceState(state)];
  const isStale = ageDays != null && ageDays >= STALE_PRICE_DAYS;
  let title = source ? `${meta.desc} · ${source}` : meta.desc;
  if (isStale) title += ` · catalog price ${ageDays} days old`;
  return (
    <span
      className="price-state-dot"
      title={title}
      aria-label={isStale ? `${meta.desc} (stale price)` : meta.desc}
      style={{
        background: meta.color,
        ...(isStale ? { boxShadow: '0 0 0 2px var(--warning)' } : {}),
      }}
    />
  );
}
