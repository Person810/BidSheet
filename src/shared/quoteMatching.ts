/**
 * Description-only quote matching (§2). No part numbers are required: most
 * underground suppliers quote on free-text descriptions, so the matcher
 * normalizes hard before it scores, then leans on a learned alias table to
 * converge per supplier.
 *
 * The flow per quote row is:
 *   1. Learned alias  — (supplier, normalized description) → catalog material.
 *      An exact, previously-confirmed mapping. Strongest signal.
 *   2. Part number    — when the quote carries one and a candidate line's
 *      material has the same part number. Strong, used opportunistically.
 *   3. Fuzzy          — token-set similarity of normalized descriptions,
 *      against the line description AND its linked material name/aliases.
 *
 * Everything here is pure so it can be unit-tested and run in the renderer;
 * the main process only persists the user's confirmed result.
 */

/**
 * Trade abbreviations expanded before scoring so "8\" DIP CL52 MJ" and
 * "8 inch ductile iron pipe class 52 mechanical joint" score as the same
 * thing. Keys are matched token-by-token (after punctuation is split out).
 */
export const TRADE_ABBREVIATIONS: Record<string, string> = {
  dip: 'ductile iron pipe',
  di: 'ductile iron',
  cl: 'class',
  in: 'in',
  inch: 'in',
  inches: 'in',
  mj: 'mechanical joint',
  fl: 'flanged',
  pe: 'plain end',
  rj: 'restrained joint',
  gv: 'gate valve',
  bfv: 'butterfly valve',
  cv: 'check valve',
  fh: 'fire hydrant',
  mh: 'manhole',
  co: 'cleanout',
  ftg: 'fitting',
  ftgs: 'fittings',
  fitting: 'fitting',
  reducer: 'reducer',
  hdpe: 'polyethylene',
  pvc: 'pvc',
  sdr: 'sdr',
  c900: 'c900',
  c905: 'c905',
  ips: 'iron pipe size',
  dr: 'dr',
  rcp: 'reinforced concrete pipe',
  cmp: 'corrugated metal pipe',
  std: 'standard',
  galv: 'galvanized',
  ss: 'stainless steel',
};

/** A bid line a quote row can be matched against. */
export interface MatchCandidate {
  lineId: number;
  description: string;
  unit: string | null;
  materialId: number | null;
  materialName?: string | null;
  /** Comma-separated alias list off the linked material, if any. */
  materialAliases?: string | null;
  materialPartNumber?: string | null;
}

/** A raw quote row to match. */
export interface QuoteRow {
  description: string;
  unit: string | null;
  partNumber?: string | null;
}

/** One learned (supplier, description) → material mapping. */
export interface AliasEntry {
  supplier: string;
  rawDescription: string; // already normalized when stored
  materialId: number | null;
  partNumber?: string | null;
}

export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';
export type MatchMethod = 'alias' | 'part_number' | 'fuzzy' | null;

export interface RankedCandidate {
  lineId: number;
  score: number; // 0..1
}

export interface MatchResult {
  status: MatchStatus;
  method: MatchMethod;
  /** Best guess line id (pre-selected in the UI), or null. */
  suggestedLineId: number | null;
  /** Ranked candidates worth showing in a picker, best first. */
  ranked: RankedCandidate[];
  /**
   * Material the alias pointed at even when no current bid line uses it —
   * lets "create new item" pre-fill from the learned mapping.
   */
  aliasMaterialId: number | null;
}

// A strong fuzzy match is auto-selected; a medium one is offered as
// ambiguous; below medium is unmatched. The gap rule keeps a clear winner
// from being demoted to "ambiguous" just because a weak runner-up exists.
const STRONG = 0.6;
const MEDIUM = 0.34;
const CLEAR_GAP = 0.15;

/** Normalize a description to a canonical, comparable string. */
export function normalizeDescription(raw: string): string {
  return normalizeTokens(raw).join(' ');
}

/** Normalize to an expanded, lowercased token list. */
export function normalizeTokens(raw: string): string[] {
  const lowered = (raw || '')
    .toLowerCase()
    // inch marks and "inch"/"in." all become a plain " in " token
    .replace(/["”]/g, ' in ')
    .replace(/\bin\.?\b/g, ' in ')
    // drop anything that isn't a letter or digit; keep word boundaries
    .replace(/[^a-z0-9]+/g, ' ');

  const tokens: string[] = [];
  for (const rawTok of lowered.split(/\s+/)) {
    if (!rawTok) continue;
    // Split letter/digit runs so joined specs expand: "cl52" → cl, 52 →
    // "class 52"; "8in" → 8, in; "sdr35" → sdr, 35. A whole-token
    // abbreviation (e.g. "c900") is checked first so it stays intact.
    const segments = TRADE_ABBREVIATIONS[rawTok] !== undefined
      ? [rawTok]
      : (rawTok.match(/[a-z]+|[0-9]+/g) ?? [rawTok]);
    for (const seg of segments) {
      const expanded = TRADE_ABBREVIATIONS[seg];
      if (expanded) {
        for (const t of expanded.split(' ')) tokens.push(t);
      } else {
        tokens.push(seg);
      }
    }
  }
  return tokens;
}

/**
 * Sørensen–Dice similarity over token sets, with a small boost when the two
 * strings share the same numeric tokens (pipe sizes, classes) — getting the
 * size right matters more than sharing filler words.
 */
export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  const dice = (2 * shared) / (setA.size + setB.size);

  const numsA = [...setA].filter((t) => /\d/.test(t));
  const numsB = new Set([...setB].filter((t) => /\d/.test(t)));
  if (numsA.length > 0) {
    const numShared = numsA.filter((t) => numsB.has(t)).length;
    const numScore = numShared / numsA.length;
    // Weight: 70% description overlap, 30% numeric agreement.
    return Math.min(1, dice * 0.7 + numScore * 0.3);
  }
  return dice;
}

/** Build a fast lookup for learned aliases keyed by supplier + description. */
export function buildAliasIndex(aliases: AliasEntry[]): Map<string, AliasEntry> {
  const index = new Map<string, AliasEntry>();
  for (const a of aliases) {
    index.set(aliasKey(a.supplier, a.rawDescription), a);
  }
  return index;
}

/** Stable key for the alias index. Supplier is matched case-insensitively. */
export function aliasKey(supplier: string, normalizedDescription: string): string {
  return `${(supplier || '').trim().toLowerCase()} ${normalizedDescription}`;
}

/**
 * Match one quote row against the job's bid lines. `supplier` scopes the
 * learned aliases. Pure: callers persist nothing.
 */
export function matchQuoteRow(
  row: QuoteRow,
  supplier: string,
  candidates: MatchCandidate[],
  aliasIndex: Map<string, AliasEntry>,
): MatchResult {
  const normalized = normalizeDescription(row.description);
  const tokens = normalizeTokens(row.description);

  // 1. Learned alias — exact (supplier, description) we've confirmed before.
  const alias = aliasIndex.get(aliasKey(supplier, normalized));
  if (alias && alias.materialId != null) {
    const lines = candidates.filter((c) => c.materialId === alias.materialId);
    if (lines.length === 1) {
      return { status: 'matched', method: 'alias', suggestedLineId: lines[0].lineId,
        ranked: [{ lineId: lines[0].lineId, score: 1 }], aliasMaterialId: alias.materialId };
    }
    if (lines.length > 1) {
      return { status: 'ambiguous', method: 'alias', suggestedLineId: lines[0].lineId,
        ranked: lines.map((l) => ({ lineId: l.lineId, score: 1 })), aliasMaterialId: alias.materialId };
    }
    // Learned mapping, but no line in this job uses that material yet — fall
    // through to fuzzy, but remember the material for "create new item".
  }

  // 2. Part number — exact on a candidate's linked material.
  const pn = (row.partNumber || '').trim().toLowerCase();
  if (pn) {
    const pnLines = candidates.filter(
      (c) => (c.materialPartNumber || '').trim().toLowerCase() === pn,
    );
    if (pnLines.length === 1) {
      return { status: 'matched', method: 'part_number', suggestedLineId: pnLines[0].lineId,
        ranked: [{ lineId: pnLines[0].lineId, score: 1 }], aliasMaterialId: alias?.materialId ?? null };
    }
    if (pnLines.length > 1) {
      return { status: 'ambiguous', method: 'part_number', suggestedLineId: pnLines[0].lineId,
        ranked: pnLines.map((l) => ({ lineId: l.lineId, score: 1 })), aliasMaterialId: alias?.materialId ?? null };
    }
  }

  // 3. Fuzzy — score every candidate on its richest available text.
  const scored = candidates
    .map((c) => {
      const candTokens = candidateTokens(c);
      return { lineId: c.lineId, score: similarity(tokens, candTokens) };
    })
    .sort((x, y) => y.score - x.score);

  const aliasMaterialId = alias?.materialId ?? null;

  if (scored.length === 0 || scored[0].score < MEDIUM) {
    return { status: 'unmatched', method: null, suggestedLineId: null, ranked: [], aliasMaterialId };
  }

  const top = scored[0];
  const second = scored[1];
  const clearWinner = !second || top.score - second.score >= CLEAR_GAP;
  const ranked = scored.filter((s) => s.score >= MEDIUM).slice(0, 5);

  if (top.score >= STRONG && clearWinner) {
    return { status: 'matched', method: 'fuzzy', suggestedLineId: top.lineId, ranked, aliasMaterialId };
  }
  return { status: 'ambiguous', method: 'fuzzy', suggestedLineId: top.lineId, ranked, aliasMaterialId };
}

/** Token pool for a candidate: description + material name + aliases. */
function candidateTokens(c: MatchCandidate): string[] {
  const parts = [c.description];
  if (c.materialName) parts.push(c.materialName);
  if (c.materialAliases) parts.push(c.materialAliases.replace(/,/g, ' '));
  return normalizeTokens(parts.join(' '));
}

/**
 * Two units differ in a way worth flagging (§1). Compared loosely so EA == ea
 * and CY == CYD don't false-flag, but per-100-ft vs LF does. Missing units
 * never flag — we only warn on a real, confident mismatch.
 */
export function unitsMismatch(quoteUnit: string | null, lineUnit: string | null): boolean {
  const a = canonicalUnit(quoteUnit);
  const b = canonicalUnit(lineUnit);
  if (!a || !b) return false;
  return a !== b;
}

function canonicalUnit(unit: string | null | undefined): string {
  const u = (unit || '').trim().toLowerCase().replace(/[.\s]/g, '');
  if (!u) return '';
  if (u === 'cyd' || u === 'cy' || u === 'cubicyard' || u === 'cubicyards') return 'cy';
  if (u === 'ea' || u === 'each') return 'ea';
  if (u === 'lf' || u === 'linearfoot' || u === 'linearfeet' || u === 'ft') return 'lf';
  if (u === 'sy' || u === 'squareyard') return 'sy';
  if (u === 'sf' || u === 'squarefoot') return 'sf';
  return u;
}
