import { isUnitPriceRounding, type UnitPriceRounding } from '../sellSchedule';

/**
 * 'sell': the owner-facing proposal — sell unit prices with markups, tax and
 * indirects folded in, the total the sum of the extensions, no cost or
 * markup lines. 'open_book': cost unit prices plus separate overhead,
 * profit, bond and tax lines and an optional cost breakdown, for cost-plus
 * and T&M work where the owner audits the markup.
 */
export type PdfPricingMode = 'sell' | 'open_book';

export type PdfSectionId = 'breakdown' | 'alternates' | 'terms' | 'signature';

export const PDF_SECTION_LABELS: Record<PdfSectionId, string> = {
  breakdown: 'Cost Breakdown',
  alternates: 'Add Alternates',
  terms: 'Terms & Conditions',
  signature: 'Signature Block',
};

export interface PdfTemplate {
  accentColor: string;
  headerColor: string;
  showUnitPrices: boolean;
  showScope: boolean;
  showCostBreakdown: boolean;
  showAlternates: boolean;
  showTerms: boolean;
  showSignature: boolean;
  termsText: string;
  signatorLabel: string;
  clientLabel: string;
  sectionOrder: PdfSectionId[];
  pricingMode: PdfPricingMode;
  /** How sell unit prices round (sell mode and the Unit Price Schedule CSV). */
  unitPriceRounding: UnitPriceRounding;
}

export const DEFAULT_PDF_TEMPLATE: PdfTemplate = {
  accentColor: '#E8A020',
  headerColor: '#1A1A2E',
  showUnitPrices: true,
  showScope: true,
  showCostBreakdown: true,
  showAlternates: true,
  showTerms: true,
  showSignature: true,
  termsText: [
    'This proposal is valid for 60 days from date of submission.',
    'Unit prices include all labor, materials, equipment, and incidentals unless otherwise noted.',
    'Permit fees, engineering, and testing to be provided by owner unless included above.',
    'Any work not specifically included in this proposal is excluded.',
    'Changes to scope of work will be addressed via change order.',
  ].join('\n'),
  signatorLabel: '',
  clientLabel: 'Accepted By',
  sectionOrder: ['breakdown', 'alternates', 'terms', 'signature'],
  pricingMode: 'sell',
  unitPriceRounding: 'up_cent',
};

/**
 * Coerce the two enum fields: a template can arrive from the renderer or
 * from a saved/synced settings row, and anything unrecognized falls back to
 * the owner-safe default rather than to open book.
 */
export function normalizePdfTemplate(t: PdfTemplate): PdfTemplate {
  return {
    ...t,
    pricingMode: t.pricingMode === 'open_book' ? 'open_book' : 'sell',
    unitPriceRounding: isUnitPriceRounding(t.unitPriceRounding) ? t.unitPriceRounding : DEFAULT_PDF_TEMPLATE.unitPriceRounding,
  };
}

export function parsePdfTemplate(json: string | null | undefined): PdfTemplate {
  if (!json) return { ...DEFAULT_PDF_TEMPLATE, sectionOrder: [...DEFAULT_PDF_TEMPLATE.sectionOrder] };
  try {
    const parsed = JSON.parse(json);
    return normalizePdfTemplate({
      ...DEFAULT_PDF_TEMPLATE,
      ...parsed,
      sectionOrder: Array.isArray(parsed.sectionOrder) ? parsed.sectionOrder : [...DEFAULT_PDF_TEMPLATE.sectionOrder],
    });
  } catch {
    return { ...DEFAULT_PDF_TEMPLATE, sectionOrder: [...DEFAULT_PDF_TEMPLATE.sectionOrder] };
  }
}
