import { dialog, app, shell, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDbPath, isSetupComplete, seedDatabase } from '../database';
import { logger } from '../logger';
import { TradeType } from '../../shared/constants/seed-data';
import { computeBidSummaryFromSections } from '../../shared/bidCalc';
import { fmtMoney } from '../../shared/calcExplain';
import { safeHandle, getSectionCostRows, getIndirectTotal, getFreightTaxable } from './shared';
import { grantPathAccess, isPathReadable } from './file-access';
import { PdfTemplate, PdfSectionId, parsePdfTemplate, DEFAULT_PDF_TEMPLATE } from '../../shared/types/pdf';
import { commitMaterialPriceImport } from './export/material-price-import-service';

export function registerExportHandlers(db: Database.Database): void {
  // ================================================================
  // QUICKBOOKS CSV EXPORT
  // ================================================================

  safeHandle('export:quickbooks-csv', async (_event, jobId: number) => {
    const { generateEstimateCSV } = await import('../csv-export');

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return { success: false, error: 'Job not found.' };

    // QuickBooks export represents the base bid — alternate sections are excluded
    const sections = db.prepare(
      'SELECT * FROM bid_sections WHERE job_id = ? AND is_alternate = 0 ORDER BY sort_order'
    ).all(jobId) as any[];

    const lineItemsBySection: Record<number, any[]> = {};
    for (const section of sections) {
      lineItemsBySection[section.id] = db
        .prepare('SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order')
        .all(section.id) as any[];
    }

    // Calculate summary (same logic as db:jobs:summary)
    const costRows = getSectionCostRows(db, jobId);
    const summary = computeBidSummaryFromSections(costRows, job, getIndirectTotal(db, jobId), getFreightTaxable(db));
    const hasMarkupOverrides = costRows.some((r) => !r.is_alternate && (
      r.overhead_percent_override != null
      || r.profit_percent_override != null
      || r.bond_percent_override != null
    ));

    const csvContent = generateEstimateCSV({ job, sections, lineItemsBySection, summary, hasMarkupOverrides });

    const safeName = (job.job_number || job.name || 'estimate').replace(/[^a-zA-Z0-9_-]/g, '_');
    const result = await dialog.showSaveDialog({
      title: 'Export Estimate to QuickBooks CSV',
      defaultPath: `${safeName}-quickbooks.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    try {
      fs.writeFileSync(result.filePath, csvContent, 'utf-8');
      logger.info('export:quickbooks-csv', `Exported job ${jobId} to ${result.filePath}`);
      return { success: true, path: result.filePath };
    } catch (err: any) {
      logger.error('export:quickbooks-csv', 'Export failed', err.stack || err.message);
      return { success: false, error: err.message };
    }
  });

  // ---- Generic CSV save (renderer builds content, main shows the dialog) ----

  safeHandle('export:save-csv', async (_event, defaultName: string, title: string, csvContent: string) => {
    const result = await dialog.showSaveDialog({
      title,
      defaultPath: defaultName.replace(/[^a-zA-Z0-9_.-]/g, '_'),
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, csvContent, 'utf-8');
    logger.info('export:save-csv', `Saved CSV to ${result.filePath}`);
    return { success: true, path: result.filePath };
  });

  // ---- Unit price schedule export ----
  // DOT/municipal-style bid form: markups, escalation, and tax are folded
  // into each line's unit SELL price instead of shown as separate rows.
  safeHandle('export:unit-price-csv', async (_event, jobId: number) => {
    const { escapeField } = await import('../csv-export');
    const row = (...fields: (string | number)[]) => fields.map((f) => escapeField(String(f))).join(',');

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return { success: false, error: 'Job not found.' };

    const sections = db.prepare(
      'SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order'
    ).all(jobId) as any[];

    const escPct = (job.escalation_percent || 0) / 100;
    const taxPct = (job.tax_percent || 0) / 100;

    const lines: string[] = [];
    lines.push('﻿' + row('UNIT PRICE SCHEDULE', job.name, job.job_number || ''));
    lines.push('');
    lines.push(row('Item No', 'Description', 'Unit', 'Quantity', 'Unit Price', 'Extension'));

    // Section markups resolve overrides the same way the bid summary does
    const sectionMarkupPct = (section: any) => (
      (section.overhead_percent_override ?? job.overhead_percent ?? 0)
      + (section.profit_percent_override ?? job.profit_percent ?? 0)
      + (section.bond_percent_override ?? job.bond_percent ?? 0)
    ) / 100;

    const lineSell = (item: any, markupPct: number): number => {
      const escalatedMaterial = (item.material_total || 0) * (1 + escPct);
      const directWithEsc = (item.total_cost || 0) - (item.material_total || 0) + escalatedMaterial;
      return directWithEsc * (1 + markupPct) + escalatedMaterial * taxPct;
    };

    // Indirect pool (marked up with job-level percentages, matching
    // bidCalc) is spread proportionally into the BASE bid's unit prices —
    // the whole point of an owner-facing unit price schedule is that
    // indirects are invisible.
    const indirectTotal = getIndirectTotal(db, jobId);
    const jobMarkupPct = ((job.overhead_percent || 0) + (job.profit_percent || 0) + (job.bond_percent || 0)) / 100;
    // Freight is priced exactly like the indirect pool (bidCalc), plus tax
    // when the freight-taxable setting says so — and spread the same way,
    // since an owner-facing schedule shouldn't show a freight line either.
    const freightTotal = Math.max(job.freight || 0, 0);
    const freightSell = freightTotal * (1 + jobMarkupPct)
      + (getFreightTaxable(db) ? freightTotal * taxPct : 0);
    const indirectSell = indirectTotal * (1 + jobMarkupPct) + freightSell;
    let baseSellSum = 0;
    for (const section of sections.filter((s) => !s.is_alternate)) {
      const items = db.prepare(
        'SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order'
      ).all(section.id) as any[];
      const markupPct = sectionMarkupPct(section);
      for (const item of items) baseSellSum += lineSell(item, markupPct);
    }
    const spreadFactor = baseSellSum > 0 ? 1 + indirectSell / baseSellSum : 1;

    const buildSection = (section: any): number => {
      const items = db.prepare(
        'SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order'
      ).all(section.id) as any[];
      if (items.length === 0) return 0;

      const markupPct = sectionMarkupPct(section);
      // Alternates never carry the base bid's indirects
      const factor = section.is_alternate ? 1 : spreadFactor;

      lines.push(row(section.is_alternate ? `ADD ALTERNATE: ${section.name}` : section.name, '', '', '', '', ''));
      let sectionTotal = 0;
      for (const item of items) {
        const sellTotal = lineSell(item, markupPct) * factor;
        const qty = item.quantity || 0;
        // Round the unit price to cents and extend from the rounded price,
        // as owner bid forms require qty x unit price = extension
        const unitSell = qty > 0 ? Math.round((sellTotal / qty) * 100) / 100 : 0;
        const extension = qty > 0 ? unitSell * qty : Math.round(sellTotal * 100) / 100;
        sectionTotal += extension;
        lines.push(row(
          item.item_number || '', item.description, item.unit, qty,
          unitSell.toFixed(2), extension.toFixed(2),
        ));
      }
      lines.push(row('', `${section.name} Subtotal`, '', '', '', sectionTotal.toFixed(2)));
      return sectionTotal;
    };

    let baseTotal = 0;
    for (const section of sections.filter((s) => !s.is_alternate)) {
      baseTotal += buildSection(section);
    }
    lines.push(row('', 'TOTAL BASE BID', '', '', '', baseTotal.toFixed(2)));

    const altSections = sections.filter((s) => s.is_alternate);
    if (altSections.length > 0) {
      lines.push('');
      for (const section of altSections) {
        buildSection(section);
      }
    }
    lines.push('');
    lines.push(row(
      indirectTotal > 0 || freightTotal > 0
        ? 'Note: unit prices include overhead, profit, bond, escalation, sales tax, and spread indirect/freight costs. Extensions use rounded unit prices and may differ from the proposal total by cents.'
        : 'Note: unit prices include overhead, profit, bond, escalation, and sales tax. Extensions use rounded unit prices and may differ from the proposal total by cents.'
    ));

    const csvContent = lines.join('\r\n') + '\r\n';
    const safeName = (job.job_number || job.name || 'schedule').replace(/[^a-zA-Z0-9_-]/g, '_');
    const result = await dialog.showSaveDialog({
      title: 'Export Unit Price Schedule',
      defaultPath: `${safeName}-unit-prices.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, csvContent, 'utf-8');
    logger.info('export:unit-price-csv', `Exported job ${jobId} to ${result.filePath}`);
    return { success: true, path: result.filePath };
  });

  // ================================================================
  // PDF BID EXPORT
  // ================================================================

  /** Gather everything buildBidPdfHtml needs (shared by export and print). */
  const gatherBidPdfData = (jobId: number): PdfData => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) throw new Error('Job not found.');

    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as any;

    const sections = db.prepare(
      'SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order'
    ).all(jobId) as any[];

    const lineItemsBySection: Record<number, any[]> = {};
    for (const section of sections) {
      lineItemsBySection[section.id] = db.prepare(
        'SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order'
      ).all(section.id) as any[];
    }

    const summary = computeBidSummaryFromSections(getSectionCostRows(db, jobId), job, getIndirectTotal(db, jobId), getFreightTaxable(db));

    return {
      job, settings, sections, lineItemsBySection,
      totals: summary,
      escalation: summary.escalation,
      indirect: summary.indirect_total,
      freight: summary.freight,
      overhead: summary.overhead, profit: summary.profit,
      bond: summary.bond, tax: summary.tax, grandTotal: summary.grandTotal,
      alternates: summary.alternates,
      escalationPct: job.escalation_percent || 0,
      overheadPct: job.overhead_percent || 0,
      profitPct: job.profit_percent || 0,
      bondPct: job.bond_percent || 0,
      taxPct: job.tax_percent || 0,
    };
  };

  safeHandle('jobs:get-pdf-html', async (_event, jobId: number, template: PdfTemplate) => {
    const data = gatherBidPdfData(jobId);
    return buildBidPdfHtml(data, template);
  });

  safeHandle('jobs:export-pdf', async (_event, jobId: number, template?: PdfTemplate) => {
    try {
      const data = gatherBidPdfData(jobId);
      const { job, settings } = data;
      let tpl = template;
      if (!tpl) {
        const row = db.prepare('SELECT pdf_template_json FROM app_settings WHERE id = 1').get() as any;
        tpl = parsePdfTemplate(row?.pdf_template_json);
      }
      const html = buildBidPdfHtml(data, tpl);

      // Create hidden BrowserWindow for PDF generation
      const win = new BrowserWindow({
        show: false,
        width: 816,
        height: 1056,
        webPreferences: { offscreen: true },
      });

      let pdfBuffer: Buffer;
      try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

        // Small delay to ensure rendering is complete
        await new Promise((resolve) => setTimeout(resolve, 300));

        const footerCompanyName = escHtml(settings?.company_name || 'Bid Proposal');
        const footerBidRef = job.job_number ? `Bid #${escHtml(job.job_number)}` : escHtml(job.name);
        pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'Letter',
          margins: { top: 0.4, bottom: 0.6, left: 0, right: 0 },
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: `<div style="width:100%;font-size:7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#999;padding:0 0.65in;display:flex;justify-content:space-between;"><span>${footerCompanyName} | ${footerBidRef}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
        });
      } finally {
        win.destroy();
      }

      const safeName = (job.job_number || job.name || 'bid').replace(/[^a-zA-Z0-9_-]/g, '_');
      const result = await dialog.showSaveDialog({
        title: 'Save Bid PDF',
        defaultPath: `${safeName}-bid.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(result.filePath, pdfBuffer);
      logger.info('jobs:export-pdf', `Exported job ${jobId} to ${result.filePath}`);
      return { success: true, filePath: result.filePath };
    } catch (err: any) {
      logger.error('jobs:export-pdf', 'PDF export failed', err.stack || err.message);
      throw new Error(err.message || 'PDF export failed.');
    }
  });

  // ---- Print Bid (via PDF pipeline) ----
  safeHandle('jobs:print-bid', async (_event, jobId: number) => {
    try {
      const data = gatherBidPdfData(jobId);
      const { job } = data;
      const row = db.prepare('SELECT pdf_template_json FROM app_settings WHERE id = 1').get() as any;
      const tpl = parsePdfTemplate(row?.pdf_template_json);
      const html = buildBidPdfHtml(data, tpl);

      // print() is NOT supported on offscreen webContents — only printToPDF is.
      // (That's why PDF export, which uses offscreen + printToPDF, works while
      // this path silently did nothing.) A normal hidden window renders fine and
      // the system print dialog still attaches to it.
      const win = new BrowserWindow({
        show: false,
        width: 816,
        height: 1056,
      });

      let printResult: { success: boolean; failureReason: string };
      try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        await new Promise((resolve) => setTimeout(resolve, 300));

        printResult = await new Promise<{ success: boolean; failureReason: string }>((resolve) => {
          win.webContents.print({ printBackground: true }, (printed, reason) => {
            resolve({ success: printed, failureReason: reason });
          });
        });
      } finally {
        win.destroy();
      }

      const { success, failureReason } = printResult;
      if (success) return { success: true };

      // Dismissing the print dialog is a normal user action, not a failure.
      if (failureReason === 'Print job canceled') {
        return { success: false, canceled: true };
      }

      // The OS print backend is unavailable — e.g. Linux with CUPS running but
      // no configured print queue yields "Failed to enumerate printers", and no
      // dialog ever appears. Rather than fail silently, fall back to the PDF
      // pipeline (which works regardless) and open it in the system's default
      // viewer so the user can print from there.
      logger.warn('jobs:print-bid', 'Native print unavailable; opening PDF instead', failureReason);
      const pdfWin = new BrowserWindow({
        show: false,
        width: 816,
        height: 1056,
        webPreferences: { offscreen: true },
      });
      let pdfBuffer: Buffer;
      try {
        await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        await new Promise((resolve) => setTimeout(resolve, 300));
        pdfBuffer = await pdfWin.webContents.printToPDF({
          printBackground: true,
          pageSize: 'Letter',
          margins: { top: 0.4, bottom: 0.6, left: 0, right: 0 },
        });
      } finally {
        pdfWin.destroy();
      }

      const safeName = (job.job_number || job.name || 'bid').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(app.getPath('temp'), `${safeName}-bid.pdf`);
      fs.writeFileSync(filePath, pdfBuffer);
      const openErr = await shell.openPath(filePath);
      if (openErr) throw new Error(openErr);
      logger.info('jobs:print-bid', `Opened ${filePath} for printing`);
      return { success: true, openedPdf: true, filePath };
    } catch (err: any) {
      logger.error('jobs:print-bid', 'Print failed', err.stack || err.message);
      throw new Error(err.message || 'Print failed.');
    }
  });

  // ================================================================
  // CSV PRICE IMPORT
  // These also keep their existing return shapes with logging added.
  // ================================================================

  function readAndParseCsv(filePath: string): { headers: string[]; rows: Record<string, string>[]; fileName: string; error?: string } {
    const fileName = path.basename(filePath);
    try {
      let raw = fs.readFileSync(filePath, 'utf-8');

      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

      const firstLine = raw.split(/\r?\n/)[0] || '';
      const delimiter = firstLine.includes('\t') ? '\t' : ',';

      const rows = parseCsvString(raw, delimiter);
      if (rows.length === 0) {
        return { error: 'No data found in file.', headers: [], rows: [], fileName };
      }

      const headers = Object.keys(rows[0]);
      logger.info('csv:parse', `Parsed ${fileName}: ${rows.length} rows, ${headers.length} columns`);
      return { headers, rows, fileName };
    } catch (err: any) {
      logger.error('csv:parse', `Failed to read ${fileName}`, err.stack || err.message);
      return { error: `Failed to read file: ${err.message}`, headers: [], rows: [], fileName };
    }
  }

  safeHandle('db:csv:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Price Sheet CSV',
      filters: [
        { name: 'CSV Files', extensions: ['csv', 'tsv', 'txt'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    grantPathAccess(result.filePaths[0]);
    return readAndParseCsv(result.filePaths[0]);
  });

  // Drag-and-drop price sheets arrive as bare paths (the preload resolves
  // dropped Files via webUtils.getPathForFile, with no main-side record of
  // the drop), so this can't demand a dialog grant. Ungranted paths must
  // carry a price-sheet extension and pass the file-access policy (see
  // file-access.ts).
  safeHandle('db:csv:parse-path', (_event, filePath: string) => {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return { error: 'File not found.', headers: [], rows: [], fileName: path.basename(resolved) };
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!['.csv', '.tsv', '.txt'].includes(ext)) {
      return { error: 'Unsupported file type. Use .csv, .tsv, or .txt files.', headers: [], rows: [], fileName: path.basename(resolved) };
    }
    if (!isPathReadable(resolved)) {
      return { error: 'Files in this location cannot be imported.', headers: [], rows: [], fileName: path.basename(resolved) };
    }
    return readAndParseCsv(resolved);
  });

  safeHandle(
    'db:materials:import-prices',
    (_event, request: any) => {
      try {
        return commitMaterialPriceImport(db, request);
      } catch (err: any) {
        logger.error('csv:import', 'Price import failed', err.stack || err.message);
        return { error: err.message, total: 0, created: 0, updated: 0, unchanged: 0, ignored: 0, invalid: 0 };
      }
    }
  );

}

// ================================================================
// PDF HTML TEMPLATE BUILDER
// ================================================================

function escHtml(str: string): string {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface PdfData {
  job: any;
  settings: any;
  sections: any[];
  lineItemsBySection: Record<number, any[]>;
  totals: any;
  escalation: number;
  indirect: number;
  freight: number;
  overhead: number;
  profit: number;
  bond: number;
  tax: number;
  grandTotal: number;
  /** Alternate sections priced independently (excluded from base totals) */
  alternates: { sectionId: number; name: string; grandTotal: number }[];
  escalationPct: number;
  overheadPct: number;
  profitPct: number;
  bondPct: number;
  taxPct: number;
}

function buildBidPdfHtml(data: PdfData, template: PdfTemplate): string {
  const { job, settings, sections, lineItemsBySection, totals,
    escalation, indirect, freight, overhead, profit, bond, tax, grandTotal, alternates,
    escalationPct, overheadPct, profitPct, bondPct, taxPct } = data;

  // The template can arrive straight from the renderer (jobs:get-pdf-html,
  // jobs:export-pdf) and these two values land unescaped inside the <style>
  // block below — only a hex literal (all the color pickers produce) may
  // pass; anything else falls back to the default.
  const cssColor = (value: any, fallback: string): string =>
    typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
  const accentColor = cssColor(template.accentColor, DEFAULT_PDF_TEMPLATE.accentColor);
  const headerColor = cssColor(template.headerColor, DEFAULT_PDF_TEMPLATE.headerColor);

  const companyName = escHtml(settings?.company_name || '');
  const companyAddress = escHtml(settings?.company_address || '');
  const companyPhone = escHtml(settings?.company_phone || '');
  const companyEmail = escHtml(settings?.company_email || '');
  const companyLogo = settings?.company_logo || '';
  const hasLogo = companyLogo.startsWith('data:');

  let bidDate = '';
  if (job.bid_date) {
    const m = job.bid_date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    bidDate = m
      ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : job.bid_date;
  }

  const baseSections = sections.filter((s: any) => !s.is_alternate);
  const altSections = sections.filter((s: any) => s.is_alternate);

  const cols = template.showUnitPrices ? 6 : 5;
  const dataColspan = template.showUnitPrices ? 4 : 3;

  const buildSectionRows = (sectionList: any[], startNumber: number): { html: string; nextNumber: number } => {
    let html = '';
    let itemNumber = startNumber;
    for (const section of sectionList) {
      const items = lineItemsBySection[section.id] || [];
      html += `<tr class="section-header"><td colspan="${cols}">${escHtml(section.name)}</td></tr>\n`;
      let sectionTotal = 0;
      items.forEach((item: any, idx: number) => {
        const rowClass = idx % 2 === 1 ? ' class="stripe"' : '';
        sectionTotal += item.total_cost || 0;
        itemNumber++;
        const unitPriceCell = template.showUnitPrices
          ? `<td class="right">${fmtMoney(item.unit_cost)}</td>` : '';
        html += `<tr${rowClass}>
          <td class="center item-num">${itemNumber}</td>
          <td class="desc">${escHtml(item.description)}</td>
          <td class="center">${escHtml(item.unit)}</td>
          <td class="center">${escHtml(String(item.quantity))}</td>
          ${unitPriceCell}
          <td class="right">${fmtMoney(item.total_cost)}</td>
        </tr>\n`;
      });
      html += `<tr class="section-subtotal">
        <td colspan="${dataColspan}"></td>
        <td class="right subtotal-label">Subtotal</td>
        <td class="right subtotal-val">${fmtMoney(sectionTotal)}</td>
      </tr>\n`;
    }
    return { html, nextNumber: itemNumber };
  };

  const baseRows = buildSectionRows(baseSections, 0);
  const tableRows = baseRows.html;

  // Summary rows
  let summaryRows = '';
  summaryRows += `<tr><td class="sum-label">Direct Cost Subtotal</td><td class="sum-val">${fmtMoney(totals.direct_cost_total)}</td></tr>`;
  if (escalationPct > 0) summaryRows += `<tr><td class="sum-label">Material Escalation (${escalationPct}%)</td><td class="sum-val">${fmtMoney(escalation)}</td></tr>`;
  if (indirect > 0) summaryRows += `<tr><td class="sum-label">Indirect Costs</td><td class="sum-val">${fmtMoney(indirect)}</td></tr>`;
  if (freight > 0) summaryRows += `<tr><td class="sum-label">Freight</td><td class="sum-val">${fmtMoney(freight)}</td></tr>`;
  if (overheadPct > 0) summaryRows += `<tr><td class="sum-label">Overhead (${overheadPct}%)</td><td class="sum-val">${fmtMoney(overhead)}</td></tr>`;
  if (profitPct > 0) summaryRows += `<tr><td class="sum-label">Profit (${profitPct}%)</td><td class="sum-val">${fmtMoney(profit)}</td></tr>`;
  if (bondPct > 0) summaryRows += `<tr><td class="sum-label">Bond (${bondPct}%)</td><td class="sum-val">${fmtMoney(bond)}</td></tr>`;
  if (taxPct > 0) summaryRows += `<tr><td class="sum-label">Sales Tax (${taxPct}%)</td><td class="sum-val">${fmtMoney(tax)}</td></tr>`;
  const totalLabel = altSections.length > 0 ? 'TOTAL BASE BID' : 'TOTAL BID AMOUNT';
  summaryRows += `<tr class="total-row"><td class="sum-label">${totalLabel}</td><td class="sum-val">${fmtMoney(grandTotal)}</td></tr>`;

  // Cost breakdown section
  let costBreakdownRows = '';
  if (totals.material_total > 0) costBreakdownRows += `<tr><td class="cb-label">Materials</td><td class="cb-val">${fmtMoney(totals.material_total)}</td></tr>`;
  if (totals.labor_total > 0) costBreakdownRows += `<tr><td class="cb-label">Labor</td><td class="cb-val">${fmtMoney(totals.labor_total)}</td></tr>`;
  if (totals.equipment_total > 0) costBreakdownRows += `<tr><td class="cb-label">Equipment</td><td class="cb-val">${fmtMoney(totals.equipment_total)}</td></tr>`;
  if (totals.subcontractor_total > 0) costBreakdownRows += `<tr><td class="cb-label">Subcontractors</td><td class="cb-val">${fmtMoney(totals.subcontractor_total)}</td></tr>`;

  // Build post-table section blocks
  const altRows = buildSectionRows(altSections, baseRows.nextNumber).html;
  const altTotalRows = altSections.map((s: any) => {
    const alt = alternates.find((a) => a.sectionId === s.id);
    return `<tr class="section-subtotal">
      <td colspan="${dataColspan}" class="desc" style="font-weight:bold;">ADD ALTERNATE: ${escHtml(s.name)}</td>
      <td class="right subtotal-label">Add to Base Bid</td>
      <td class="right subtotal-val">${fmtMoney(alt?.grandTotal || 0)}</td>
    </tr>`;
  }).join('\n');

  const sectionBlocks: Record<PdfSectionId, string> = {
    breakdown: template.showCostBreakdown && costBreakdownRows ? `
    <div style="margin-top:16px;">
      <div class="cb-title">Cost Breakdown</div>
      <table class="cb-table">${costBreakdownRows}</table>
    </div>` : '',

    alternates: template.showAlternates && altSections.length > 0 ? `
    <div class="scope-section" style="margin-top:14px;">
      <div class="scope-heading">Add Alternates</div>
      <div class="scope-body">The following alternates are priced separately and are not included in the base bid amount.</div>
    </div>
    <table class="items-table">
      <thead>
        <tr>
          <th class="left" style="width:5%;">#</th>
          <th class="left">Description</th>
          <th>Unit</th>
          <th>Qty</th>
          ${template.showUnitPrices ? '<th>Unit Price</th>' : ''}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${altRows}${altTotalRows}</tbody>
    </table>` : '',

    terms: template.showTerms ? (() => {
      const termsText = typeof template.termsText === 'string' ? template.termsText : '';
      const lines = termsText.split('\n').map(l => l.trim()).filter(Boolean);
      const termsBody = lines.length > 0
        ? `<ul>${lines.map(l => `<li>${escHtml(l)}</li>`).join('')}</ul>`
        : '';
      return termsBody ? `
    <div class="terms-section">
      <div class="terms-heading">Terms &amp; Conditions</div>
      <div class="terms-body">${termsBody}</div>
    </div>` : '';
    })() : '',

    signature: template.showSignature ? `
    <div class="signature-area">
      <div class="sig-block">
        <div class="sig-line">${escHtml(template.signatorLabel || companyName || 'Contractor')}</div>
        <div class="sig-sub">Authorized Signature &amp; Date</div>
      </div>
      <div class="sig-block">
        <div class="sig-line">${escHtml(template.clientLabel || 'Accepted By')}</div>
        <div class="sig-sub">Client Signature &amp; Date</div>
      </div>
    </div>` : '',
  };

  const postTableHtml = template.sectionOrder.map(id => sectionBlocks[id]).join('\n');

  // Header
  const infoLines: string[] = [];
  if (companyAddress) infoLines.push(companyAddress);
  if (companyPhone) infoLines.push(companyPhone);
  if (companyEmail) infoLines.push(companyEmail);

  const headerLeft = hasLogo
    ? `<img src="${escHtml(companyLogo)}" style="max-height:48px;max-width:160px;object-fit:contain;" />`
    : `<span style="color:#fff;font-weight:bold;font-size:15px;">${companyName}</span>`;

  const companyTagline = escHtml(settings?.company_tagline || '');
  const taglineHtml = companyTagline
    ? `<span style="color:var(--accent);font-size:9px;">${companyTagline}</span>` : '';
  const headerLeftRow2 = hasLogo
    ? `${taglineHtml}${taglineHtml ? '<br/>' : ''}<span style="color:#fff;font-weight:bold;font-size:12px;">${companyName}</span>`
    : taglineHtml;

  const locationHtml = job.location ? `<td>
      <div class="info-label">Location</div>
      <div class="info-value">${escHtml(job.location)}</div>
    </td>` : '';

  const descriptionHtml = template.showScope && job.description ? `
    <div class="scope-section">
      <div class="scope-heading">Scope of Work</div>
      <div class="scope-body">${escHtml(job.description)}</div>
    </div>` : '';

  const unitPriceHeaderCell = template.showUnitPrices ? '<th class="col-uprice">Unit Price</th>' : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  :root {
    --accent: ${accentColor};
    --header: ${headerColor};
  }
  @page { size: Letter; margin: 0.65in 0.65in 0.85in 0.65in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1A2E; font-size: 9px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .header-table { width: 100%; border-collapse: collapse; background: var(--header); border-radius: 2px; }
  .header-table td { padding: 10px 14px; vertical-align: middle; }
  .header-right { text-align: right; color: #ccc; font-size: 8px; line-height: 1.6; }
  .gold-rule { border: none; border-top: 3px solid var(--accent); margin: 0; }

  .proposal-title-bar { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 8px 0; }
  .bid-title { font-weight: bold; color: #1A1A2E; font-size: 13px; letter-spacing: 0.5px; }
  .bid-date-badge { font-size: 8px; color: #7F8C8D; }

  .info-strip { width: 100%; border-collapse: collapse; background: #F8F9FA; border-bottom: 1.5px solid var(--accent); }
  .info-strip td { padding: 7px 10px; vertical-align: top; }
  .info-label { font-size: 7px; color: #7F8C8D; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 2px; }
  .info-value { font-size: 9px; color: #1A1A2E; font-weight: 500; }

  .scope-section { margin: 10px 0; padding: 8px 10px; background: #FAFBFC; border-left: 3px solid var(--accent); }
  .scope-heading { font-size: 8px; font-weight: bold; color: #424949; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 3px; }
  .scope-body { font-size: 8.5px; color: #333; line-height: 1.5; white-space: pre-wrap; }

  .items-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .items-table thead { display: table-header-group; }
  .items-table th { background: var(--header); color: #fff; font-weight: bold; font-size: 7.5px; padding: 5px 6px; text-align: center; border: 0.25px solid #D5D8DC; text-transform: uppercase; letter-spacing: 0.3px; }
  .items-table th.left { text-align: left; }
  .items-table td { padding: 4px 6px; border: 0.25px solid #D5D8DC; font-size: 8.5px; }
  .items-table .item-num { width: 5%; font-size: 7.5px; color: #7F8C8D; }
  .items-table .desc { text-align: left; padding-left: 8px; width: 40%; }
  .items-table .center { text-align: center; }
  .items-table .right { text-align: right; }
  .items-table .section-header td { background: #424949; color: #fff; font-weight: bold; font-size: 9px; padding: 5px 8px; border-top: 1.5px solid var(--accent); }
  .items-table tr.stripe td { background: #F4F5F6; }
  .items-table .section-subtotal td { background: #F8F9FA; border-top: 0.5px solid var(--accent); }
  .subtotal-label { font-weight: bold; color: #424949; font-size: 8.5px; }
  .subtotal-val { font-weight: bold; font-size: 8.5px; }
  .col-unit { width: 7%; }
  .col-qty { width: 8%; }
  .col-uprice { width: 17%; }
  .col-amount { width: 17%; }

  .summary-area { display: flex; justify-content: flex-end; margin-top: 16px; }
  .summary-table { width: 48%; border-collapse: collapse; }
  .summary-table td { padding: 4px 8px; font-size: 9px; }
  .sum-label { text-align: right; color: #424949; }
  .sum-val { text-align: right; font-weight: 500; }
  .summary-table .total-row td { background: var(--header); color: #fff; font-weight: bold; font-size: 11px; border-top: 2px solid var(--accent); padding: 7px 8px; }

  .cb-title { font-size: 8px; font-weight: bold; color: #424949; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; border-bottom: 1px solid #D5D8DC; padding-bottom: 3px; }
  .cb-table { width: 36%; border-collapse: collapse; }
  .cb-table td { padding: 2px 6px; font-size: 8.5px; }
  .cb-label { color: #666; }
  .cb-val { text-align: right; font-weight: 500; }

  .terms-section { margin-top: 20px; page-break-inside: avoid; }
  .terms-heading { font-size: 8px; font-weight: bold; color: #424949; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
  .terms-body { font-size: 7.5px; color: #666; line-height: 1.5; }
  .terms-body ul { margin: 2px 0 0 14px; }
  .terms-body li { margin-bottom: 1px; }

  .signature-area { margin-top: 24px; display: flex; justify-content: space-between; gap: 40px; page-break-inside: avoid; }
  .sig-block { flex: 1; }
  .sig-line { border-top: 1px solid #333; margin-top: 30px; padding-top: 4px; font-size: 8px; color: #424949; }
  .sig-sub { font-size: 7px; color: #999; margin-top: 1px; }
</style>
</head>
<body>

<table class="header-table">
  <tr>
    <td>${headerLeft}</td>
    <td></td>
  </tr>
  <tr>
    <td>${headerLeftRow2}</td>
    <td class="header-right">${infoLines.join('<br/>')}</td>
  </tr>
</table>
<hr class="gold-rule"/>

<div class="proposal-title-bar">
  <div class="bid-title">BID PROPOSAL</div>
  <div class="bid-date-badge">${bidDate ? 'Submitted ' + escHtml(bidDate) : ''}</div>
</div>

<table class="info-strip">
  <tr>
    <td><div class="info-label">Project</div><div class="info-value">${escHtml(job.name)}</div></td>
    <td><div class="info-label">Owner / GC</div><div class="info-value">${escHtml(job.client || '—')}</div></td>
    ${locationHtml}
    <td><div class="info-label">Bid #</div><div class="info-value">${escHtml(job.job_number || '—')}</div></td>
  </tr>
</table>

${descriptionHtml}

<table class="items-table">
  <thead>
    <tr>
      <th style="width:5%">#</th>
      <th class="left" style="width:40%">Description</th>
      <th class="col-unit">Unit</th>
      <th class="col-qty">Qty</th>
      ${unitPriceHeaderCell}
      <th class="col-amount">Amount</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>

<div class="summary-area">
  <table class="summary-table">${summaryRows}</table>
</div>

${postTableHtml}

</body>
</html>`;
}

// ================================================================
// CSV PARSER
// Handles: quoted fields, escaped quotes, commas inside quotes,
// CRLF/LF line endings, BOM, empty fields, tab-delimited.
// ================================================================

function parseCsvString(raw: string, delimiter: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < raw.length && raw[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"' && field.length === 0) {
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        current.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\r') {
        current.push(field.trim());
        field = '';
        rows.push(current);
        current = [];
        i++;
        if (i < raw.length && raw[i] === '\n') i++;
      } else if (ch === '\n') {
        current.push(field.trim());
        field = '';
        rows.push(current);
        current = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  if (field || current.length > 0) {
    current.push(field.trim());
    rows.push(current);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.length > 0));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0];
  const dataRows: Record<string, string>[] = [];

  for (let r = 1; r < nonEmpty.length; r++) {
    const row = nonEmpty[r];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = c < row.length ? row[c] : '';
    }
    dataRows.push(obj);
  }

  return dataRows;
}
