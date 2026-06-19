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
};

export function parsePdfTemplate(json: string | null | undefined): PdfTemplate {
  if (!json) return { ...DEFAULT_PDF_TEMPLATE, sectionOrder: [...DEFAULT_PDF_TEMPLATE.sectionOrder] };
  try {
    const parsed = JSON.parse(json);
    return {
      ...DEFAULT_PDF_TEMPLATE,
      ...parsed,
      sectionOrder: Array.isArray(parsed.sectionOrder) ? parsed.sectionOrder : [...DEFAULT_PDF_TEMPLATE.sectionOrder],
    };
  } catch {
    return { ...DEFAULT_PDF_TEMPLATE, sectionOrder: [...DEFAULT_PDF_TEMPLATE.sectionOrder] };
  }
}
