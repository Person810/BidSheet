import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function between(contents: string, start: string, end: string): string {
  const startIndex = contents.indexOf(start);
  if (startIndex < 0) return '';
  const endIndex = contents.indexOf(end, startIndex + start.length);
  return endIndex < 0
    ? contents.slice(startIndex)
    : contents.slice(startIndex, endIndex);
}

const csvImportModal = source(
  'src/renderer/components/CsvImportModal.tsx',
);
const materialsPage = source(
  'src/renderer/pages/MaterialsPage.tsx',
);

describe('material import successful-completion boundary', () => {
  const commitHandler = between(
    csvImportModal,
    'const handleCommit = async () => {',
    'const updateDraft =',
  );
  const doneView = between(
    csvImportModal,
    "{step === 'done'",
    '</div>\n  );',
  );

  it('preserves the single privileged commit and retains its successful result', () => {
    expect(csvImportModal.match(/window\.api\.importPriceSheet/g)).toHaveLength(1);
    expect(commitHandler).toContain('setResult(committed)');
    expect(commitHandler).toContain("setStep('done')");
  });

  it('starts completion immediately after a successful commit rather than from Done', () => {
    const commitIndex = commitHandler.indexOf(
      'await window.api.importPriceSheet(request)',
    );
    const completionIndex = commitHandler.search(/\bawait\s+onComplete\(\)/);

    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(completionIndex).toBeGreaterThan(commitIndex);
    expect(doneView).not.toContain('onComplete()');
  });

  it('invokes the completion callback exactly once', () => {
    expect(csvImportModal.match(/\bonComplete\(\)/g)).toHaveLength(1);
    expect(commitHandler.match(/\bonComplete\(\)/g)).toHaveLength(1);
  });

  it('catches a post-commit refresh failure separately from import failure', () => {
    const completionCall = commitHandler.search(/\bawait\s+onComplete\(\)/);
    const refreshWarning = commitHandler.search(
      /import (?:was |has )?(?:completed|succeeded)[\s\S]{0,160}(?:refresh|reopen materials)/i,
    );

    expect(commitHandler).toMatch(
      /setResult\(committed\)[\s\S]*try\s*\{[\s\S]*await\s+onComplete\(\)[\s\S]*\}\s*catch/,
    );
    expect(refreshWarning).toBeGreaterThan(completionCall);
    expect(commitHandler).toContain("'Import failed.'");
  });

  it('keeps close routes independent from completion and refresh', () => {
    const requestClose = between(
      csvImportModal,
      'const requestClose = () => {',
      'const title =',
    );

    expect(requestClose).toContain('onClose()');
    expect(requestClose).not.toContain('onComplete');
    expect(doneView).toContain('onClose()');
    expect(doneView).not.toContain('onComplete');
  });
});

describe('Materials page post-import reveal contract', () => {
  it('uses a dedicated completion handler instead of direct material-only wiring', () => {
    expect(materialsPage).not.toContain('onComplete={loadMaterials}');
    expect(materialsPage).toMatch(
      /const handleMaterialImportComplete = useCallback\(async \(\) => \{/,
    );
    expect(materialsPage).toContain(
      'onComplete={handleMaterialImportComplete}',
    );
  });

  it('refreshes categories and materials before revealing an unfiltered catalogue', () => {
    const completionHandler = between(
      materialsPage,
      'const handleMaterialImportComplete = useCallback(async () => {',
      '\n  },',
    );
    const refreshIndex = completionHandler.indexOf(
      'await Promise.all([loadCategories(), loadMaterials()])',
    );
    const clearSearchIndex = completionHandler.indexOf("setSearchTerm('')");
    const showAllIndex = completionHandler.indexOf('setSelectedCategory(null)');

    expect(refreshIndex).toBeGreaterThanOrEqual(0);
    expect(clearSearchIndex).toBeGreaterThan(refreshIndex);
    expect(showAllIndex).toBeGreaterThan(refreshIndex);
  });
});

describe('material price import pre-selection guide contract', () => {
  const pickView = between(
    csvImportModal,
    "{step === 'pick'",
    "{step === 'map'",
  );
  const pickerIndex = pickView.indexOf('<CsvDropZone');

  it('states the header-row requirement and both required mappings before the picker', () => {
    const guideIndex = pickView.search(/header row/i);

    expect(guideIndex).toBeGreaterThanOrEqual(0);
    expect(guideIndex).toBeLessThan(pickerIndex);
    expect(pickView).toMatch(/required[\s\S]{0,120}Material Name/i);
    expect(pickView).toMatch(/required[\s\S]{0,160}Unit Cost/i);
  });

  it('lists every optional mapping before the picker', () => {
    const optionalIndex = pickView.search(/optional/i);

    expect(optionalIndex).toBeGreaterThanOrEqual(0);
    expect(optionalIndex).toBeLessThan(pickerIndex);
    for (const field of [
      'Unit',
      'Supplier',
      'Part Number',
      'Description',
      'Category',
    ]) {
      expect(pickView).toContain(field);
    }
  });

  it('explains that flexible supplier headers are mapped on the next step', () => {
    expect(pickView).toMatch(
      /(?:header names?|column names?)[\s\S]{0,100}(?:vary|different|arbitrary)/i,
    );
    expect(pickView).toMatch(
      /map(?:ped|ping)?[\s\S]{0,100}(?:next|following) step/i,
    );
  });

  it('states both import defaults before file selection', () => {
    expect(pickView).toMatch(/(?:missing|blank|absent) Unit[\s\S]{0,100}EA/i);
    expect(pickView).toMatch(
      /(?:missing|unknown|unmatched)[\s\S]{0,80}Category[\s\S]{0,100}Uncategorised/i,
    );
  });

  it('states accepted formats, delimiters and the data-row limit', () => {
    expect(pickView).toMatch(/CSV[\s\S]{0,80}TSV[\s\S]{0,80}TXT/i);
    expect(pickView).toMatch(/comma[\s\S]{0,80}tab/i);
    expect(pickView).toMatch(/10,000 data rows/i);
  });

  it('provides a native expandable, text-readable exact example before the picker', () => {
    const detailsIndex = pickView.indexOf('<details');
    const summaryIndex = pickView.indexOf('<summary');
    const header =
      'Material Name,Unit Cost,Unit,Supplier,Part Number,Description,Category';
    const data =
      'Cisco Catalyst 9600 Chassis,16488.18,EA,ITNest,C9606R,"Core network chassis",IT Equipment';

    expect(detailsIndex).toBeGreaterThanOrEqual(0);
    expect(detailsIndex).toBeLessThan(pickerIndex);
    expect(summaryIndex).toBeGreaterThan(detailsIndex);
    expect(pickView).toContain(header);
    expect(pickView).toContain(data);
    expect(pickView).toMatch(/<(?:pre|code)\b/);
    expect(pickView).toMatch(
      /<(?:pre|code)[\s\S]{0,300}(?:overflowX:\s*'auto'|whiteSpace:\s*'(?:pre-wrap|break-spaces)'|overflowWrap:\s*'anywhere')/,
    );
  });
});
