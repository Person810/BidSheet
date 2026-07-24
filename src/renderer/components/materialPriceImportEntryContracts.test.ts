import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

const materialsPage = source('src/renderer/pages/MaterialsPage.tsx');
const catalogModal = source('src/renderer/components/CsvImportModal.tsx');
const catalogReview = source(
  'src/renderer/components/MaterialPriceImportReview.tsx',
);
const catalogValidation = source(
  'src/renderer/components/materialPriceImportReviewValidation.ts',
);
const catalogImport = `${catalogModal}\n${catalogReview}\n${catalogValidation}`;
const jobImport = source('src/renderer/pages/jobs/JobPriceImportModal.tsx');
const preload = source('src/main/preload.ts');
const windowTypes = source('src/shared/types/window.d.ts');

describe('catalog material price import entry contract', () => {
  it('keeps the existing Materials-page CSV import entry and completion refresh', () => {
    expect(materialsPage).toContain(
      "import { CsvImportModal } from '../components/CsvImportModal';",
    );
    expect(materialsPage).toContain('<CsvImportModal');
    expect(materialsPage).toContain(
      'onComplete={handleMaterialImportComplete}',
    );
    expect(materialsPage).not.toContain('onComplete={loadMaterials}');
    expect(materialsPage).toContain('onClose={() => setShowImportModal(false)}');
  });

  it('keeps Cancel and Back navigation free of privileged writes', () => {
    expect(catalogImport.match(/window\.api\.importPriceSheet/g)).toHaveLength(1);
    expect(catalogModal).toMatch(
      /const handleCommit[\s\S]*window\.api\.importPriceSheet/,
    );
    expect(catalogModal).toMatch(
      /onClick=\{onClose\}>Cancel<\/button>/,
    );
    expect(catalogModal).toMatch(
      /onClick=\{\(\) => setStep\('pick'\)\}>Back<\/button>/,
    );
    expect(catalogModal).toContain("onBack={() => setStep('map')}");
    expect(catalogReview).toMatch(/onClick=\{onBack\}[\s\S]*Back/);
    expect(catalogModal).toContain('if (!importing) onClose()');
    expect(catalogModal).toContain('onClick={requestClose}');
  });

  it('wires the immutable reconciliation state into the catalogue importer', () => {
    expect(catalogImport).toMatch(
      /from ['"]\.\/materialPriceImportState['"]/,
    );
    expect(catalogImport).toContain('createMaterialPriceImportState');
    expect(catalogImport).toContain('setMaterialPriceImportRowAction');
    expect(catalogImport).toContain('setMaterialPriceImportManualTarget');
    expect(catalogImport).toContain('acknowledgeMaterialPriceImportUnitMismatch');
  });

  it('renders four accessible row classifications and matching filters', () => {
    for (const classification of ['Matched', 'Review', 'Unmatched', 'Invalid']) {
      expect(catalogImport).toContain(classification);
    }
    expect(catalogImport).toMatch(/aria-label=["']Filter import rows["']/);
    for (const filter of ['all', 'matched', 'review', 'unmatched', 'invalid']) {
      expect(catalogReview).toContain(`value: '${filter}'`);
    }
    expect(catalogReview).toContain(
      '<option key={value} value={value}>{label}</option>',
    );
    expect(catalogImport).toMatch(/aria-live=["']polite["']/);
  });

  it('provides accessible manual match, create and exclusion controls per row', () => {
    expect(catalogReview).toContain('Search existing materials');
    expect(catalogReview).toContain('targetSearch');
    expect(catalogImport).toMatch(/Choose existing material/i);
    expect(catalogImport).toMatch(/Create new material/i);
    expect(catalogImport).toMatch(/Exclude from import/i);
    expect(catalogImport).toMatch(/aria-label=\{`Choose material for \$\{/);
    expect(catalogImport).toMatch(/unit mismatch/i);
    expect(catalogImport).toMatch(/acknowledgeMaterialPriceImportUnitMismatch/);
    expect(catalogReview).toContain('Current price');
    expect(catalogReview).toContain('Imported price');
    expect(catalogReview).toContain('Match reason');
    expect(catalogReview).toContain('Proposed action: Update');
    expect(catalogReview).toContain('Possible match — review');
  });

  it('makes selection the complete normal workflow for unmatched rows', () => {
    expect(catalogReview).toMatch(
      /Selected unmatched rows will be created as new materials/i,
    );
    expect(catalogReview).toMatch(/Deselected rows will not be imported/i);
    expect(catalogReview).toMatch(/Proposed action: Create New Material/i);
    expect(catalogReview).not.toMatch(/Create selected/i);
    expect(catalogReview).not.toMatch(/Ignore selected/i);
    expect(catalogReview).not.toMatch(/Category for new materials/i);
  });

  it('exposes filter-scoped import controls and honest inclusion language', () => {
    expect(catalogReview).toMatch(/Select all shown/i);
    expect(catalogReview).toMatch(/Deselect all shown/i);
    expect(catalogReview).toMatch(/shown rows selected for import/i);
    expect(catalogReview).toMatch(/<th[^>]*>[\s\S]*Import[\s\S]*<\/th>/i);
    expect(catalogReview).toMatch(/aria-label=\{`Import \$\{row\.description\}`\}/);
    expect(catalogReview).toContain('Excluded from import');
    expect(catalogReview).toContain('setMaterialPriceImportShownSelection');
    expect(catalogReview).toContain('materialPriceImportVisibleSelection');
  });

  it('keeps row category editing and the explicit Uncategorised fallback', () => {
    expect(catalogReview).toContain('Uncategorised (create or reuse)');
    expect(catalogReview).toContain('Category for new material');
    expect(catalogReview).not.toContain('applyMaterialPriceImportBulkActionWithResult');
  });

  it('exposes editable fields and a visible Uncategorised fallback for creates', () => {
    expect(catalogModal).toContain('onDraftChange');
    for (const label of [
      'Name for new material',
      'Unit for new material',
      'Supplier for new material',
      'Part number for new material',
      'Description for new material',
      'Uncategorised (create or reuse)',
    ]) {
      expect(catalogReview).toContain(label);
    }
    expect(catalogReview).toContain(
      'evaluateMaterialPriceImportConfirmationBlockers',
    );
    expect(catalogReview).toContain(
      'isMaterialPriceImportConfirmationEnabled',
    );
  });

  it('blocks confirm through state authority and shows the full result summary', () => {
    expect(catalogReview).toContain(
      'isMaterialPriceImportConfirmationEnabled(blockers)',
    );
    expect(catalogImport).toMatch(/Confirm (?:&|and) import/i);
    for (const outcome of ['Updated', 'Created', 'Ignored']) {
      expect(catalogImport).toContain(outcome);
    }
  });

  it('uses one visible blocker model for every disabled confirmation state', () => {
    expect(catalogReview).toContain(
      'evaluateMaterialPriceImportConfirmationBlockers',
    );
    expect(catalogReview).toContain(
      'isMaterialPriceImportConfirmationEnabled',
    );
    expect(catalogReview).toMatch(/role=["']alert["']/);
    expect(catalogReview).toMatch(/Show first|Show blocking|Show row/i);
    expect(catalogReview).toMatch(/material-price-import-row-/);
    expect(catalogReview).toMatch(
      /disabled=\{[\s\S]*!isMaterialPriceImportConfirmationEnabled/,
    );
    expect(catalogImport).toContain('Select at least one row to import.');
    expect(catalogImport).toMatch(/selected rows/i);
  });

  it('routes commit through the strict selected-only request builder', () => {
    expect(catalogModal).toContain('buildMaterialPriceImportRequest');
    expect(catalogModal).not.toMatch(
      /return \{[\s\S]*action: 'ignore',[\s\S]*reason: row\.classification/,
    );
  });
});

describe('per-job quote importer boundary remains unchanged', () => {
  it('keeps JobPriceImportModal on the per-job context and commit API only', () => {
    expect(jobImport).toContain('priceImportContext(jobId)');
    expect(jobImport).toContain('priceImportCommit(jobId');
    expect(jobImport).not.toContain('materialPriceImportState');
    expect(jobImport).not.toContain('importPriceSheet(');
  });

  it('keeps the existing per-job preload and window API signatures', () => {
    expect(preload).toContain(
      "priceImportContext: (jobId: number) => invoke('db:price-import:context', jobId)",
    );
    expect(preload).toContain(
      "priceImportCommit: (jobId: number, payload: any) => invoke('db:price-import:commit', jobId, payload)",
    );
    expect(windowTypes).toContain(
      'priceImportContext: (jobId: number) => Promise<PriceImportContext>;',
    );
    expect(windowTypes).toContain(
      'priceImportCommit: (jobId: number, payload: PriceImportCommitPayload) => Promise<PriceImportCommitResult>;',
    );
  });
});
