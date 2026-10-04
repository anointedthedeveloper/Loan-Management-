import type PDFKit from 'pdfkit';
import type { Worksheet, Row as XRow } from 'exceljs';

/** Shared look for every downloaded / exported document (Excel and PDF), so they all read as one Protech product. */
export const BRAND = { dark: '0B3D2E', mid: '14694F', accent: '4ADE80', ink: '111827', mute: '64748B', line: 'D9E2DD', zebra: 'F3F8F5', panel: 'EAF3EE', red: 'B91C1C', amber: 'B45309', ok: '047857', blue: '1D4ED8' } as const;
const argb = (hex: string) => `FF${hex}`;
const hash = (hex: string) => `#${hex}`;

/** Text colour for a status word (paid, overdue, ...). */
export function statusColor(status: string): string | null {
  const s = status.toLowerCase().replace(/_/g, ' ');
  if (/(paid|completed|active|posted|approved|settled)/.test(s) && !/(part|unpaid)/.test(s)) return BRAND.ok;
  if (/(overdue|defaulted|reversed|rejected|unpaid)/.test(s)) return BRAND.red;
  if (/(part|pending|due|upcoming|cancel)/.test(s)) return BRAND.amber;
  return null;
}

export const utcDateOf = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return null;
};

/* =============================== Excel =============================== */
export const XL_MONEY = '#,##0.00;[Red]-#,##0.00;"–"';
export const XL_DATE = 'dd mmm yyyy';
const thin = { style: 'thin' as const, color: { argb: argb(BRAND.line) } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

/** Rows 1-3: brand banner, document title line, spacer. Returns the next free row number (4). */
export function xlTitleBlock(ws: Worksheet, company: string, title: string, subtitle: string, ncols: number) {
  const n = Math.max(ncols, 4);
  ws.addRow([company]); ws.mergeCells(1, 1, 1, n);
  const b = ws.getCell(1, 1); b.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } }; b.alignment = { vertical: 'middle', indent: 1 };
  b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.dark) } }; ws.getRow(1).height = 34;
  for (let c = 2; c <= n; c++) ws.getCell(1, c).fill = b.fill;
  ws.addRow([subtitle ? `${title}  ·  ${subtitle}` : title]); ws.mergeCells(2, 1, 2, n);
  const t = ws.getCell(2, 1); t.font = { bold: true, size: 12, color: { argb: argb(BRAND.dark) } }; t.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(2).height = 22;
  ws.addRow([]); ws.getRow(3).height = 6;
  ws.views = [{ showGridLines: false }];
  return 4;
}

export function xlHeaderRow(row: XRow, widthCols: number) {
  row.height = 26;
  for (let c = 1; c <= widthCols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.mid) } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = box;
  }
}

/** Zebra stripes, borders and per-column alignment for data rows [first..last]. `kinds[i]` is the column's content type. */
export function xlStyleBody(ws: Worksheet, first: number, last: number, kinds: ('text' | 'money' | 'date' | 'number' | 'status')[]) {
  for (let r = first; r <= last; r++) {
    const row = ws.getRow(r); row.height = 18;
    kinds.forEach((k, i) => {
      const cell = row.getCell(i + 1);
      cell.border = box; cell.font = { ...cell.font, size: 10, color: { argb: argb(BRAND.ink) } };
      if ((r - first) % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.zebra) } };
      cell.alignment = { vertical: 'middle', horizontal: k === 'money' || k === 'number' ? 'right' : k === 'date' || k === 'status' ? 'center' : 'left', wrapText: false };
      if (k === 'money') cell.numFmt = XL_MONEY;
      if (k === 'date') cell.numFmt = XL_DATE;
      if (k === 'status') { const c = statusColor(String(cell.value ?? '')); if (c) cell.font = { size: 10, bold: true, color: { argb: argb(c) } }; }
    });
  }
}

export function xlTotalsRow(row: XRow, ncols: number, kinds: string[]) {
  row.height = 22;
  for (let c = 1; c <= ncols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 10.5, color: { argb: argb(BRAND.dark) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.panel) } };
    cell.border = { top: { style: 'medium', color: { argb: argb(BRAND.dark) } }, bottom: { style: 'double', color: { argb: argb(BRAND.dark) } }, left: thin, right: thin };
    if (kinds[c - 1] === 'money') { cell.numFmt = XL_MONEY; cell.alignment = { horizontal: 'right', vertical: 'middle' }; }
  }
}

/** Label / value pairs in a tinted panel (client and loan information blocks). */
export function xlKeyValues(ws: Worksheet, heading: string, pairs: [string, string | number | Date | null][], span: number) {
  const h = ws.addRow([heading.toUpperCase()]); ws.mergeCells(h.number, 1, h.number, span);
  h.getCell(1).font = { bold: true, size: 10, color: { argb: argb(BRAND.mid) } }; h.height = 20; h.getCell(1).border = { bottom: { style: 'medium', color: { argb: argb(BRAND.accent) } } };
  for (const [k, v] of pairs) {
    const r = ws.addRow([k, v ?? '—']); r.height = 18;
    ws.mergeCells(r.number, 2, r.number, Math.min(span, 4));
    r.getCell(1).font = { size: 10, color: { argb: argb(BRAND.mute) } };
    r.getCell(2).font = { size: 10, bold: true, color: { argb: argb(BRAND.ink) } }; r.getCell(2).alignment = { horizontal: 'left' };
    if (v instanceof Date) r.getCell(2).numFmt = XL_DATE;
    for (let c = 1; c <= Math.min(span, 4); c++) r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.panel) } };
  }
  ws.addRow([]);
}

export function xlFooter(ws: Worksheet, text: string, span: number) {
  ws.addRow([]);
  const r = ws.addRow([text]); ws.mergeCells(r.number, 1, r.number, span);
  r.getCell(1).font = { italic: true, size: 9, color: { argb: argb(BRAND.mute) } };
}

/** Print-ready: landscape/portrait, one page wide, repeated header row, page numbers. */
export function xlPrint(ws: Worksheet, opts: { landscape?: boolean; headerRow?: number; company: string }) {
  ws.pageSetup = { orientation: opts.landscape === false ? 'portrait' : 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }, ...(opts.headerRow ? { printTitlesRow: `${opts.headerRow}:${opts.headerRow}` } : {}) };
  ws.headerFooter = { oddFooter: `&L&8${opts.company.replace(/&/g, '&&')}&C&8Page &P of &N&R&8Printed &D` };
}

/* ================================ PDF ================================ */
type Doc = PDFKit.PDFDocument;
export const pdfW = (doc: Doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

/** The "P" tile used as the logo. */
function logo(doc: Doc, x: number, y: number, s: number) {
  doc.save().roundedRect(x, y, s, s, s * 0.22).fill(hash(BRAND.accent)).restore();
  doc.save().translate(x, y).scale(s / 64);
  doc.path('M19 50V14h16c8 0 12.5 4.3 12.5 11S43 36 35 36h-7v14z').fill(hash(BRAND.dark));
  doc.path('M28 22v7h6.5c2.8 0 4.3-1.3 4.3-3.5S37.3 22 34.5 22z').fill(hash(BRAND.accent));
  doc.restore();
}

/** Full-width brand band at the top of the first page. Leaves `doc.y` below it. */
export function pdfBand(doc: Doc, company: string, docTitle: string, lines: string[]) {
  const w = doc.page.width;
  doc.save().rect(0, 0, w, 78).fill(hash(BRAND.dark)).restore();
  doc.save().rect(0, 78, w, 3).fill(hash(BRAND.accent)).restore();
  logo(doc, doc.page.margins.left, 20, 38);
  const x = doc.page.margins.left + 50;
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#FFFFFF').text(company, x, 20, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#BFE3CE').text(lines.filter(Boolean).join('   ·   ') || ' ', x, 42, { lineBreak: false, width: w - x - 190 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF').text(docTitle.toUpperCase(), w - doc.page.margins.right - 220, 26, { width: 220, align: 'right', lineBreak: false });
  doc.y = 96; doc.x = doc.page.margins.left;
}

/** Slim brand strip + running head on continuation pages. */
export function pdfRunningHead(doc: Doc, company: string, docTitle: string) {
  const w = doc.page.width;
  doc.save().rect(0, 0, w, 22).fill(hash(BRAND.dark)).restore();
  doc.save().rect(0, 22, w, 2).fill(hash(BRAND.accent)).restore();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF').text(company, doc.page.margins.left, 7, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#BFE3CE').text(docTitle, w - doc.page.margins.right - 260, 7, { width: 260, align: 'right', lineBreak: false });
  doc.y = 38; doc.x = doc.page.margins.left;
}

export function pdfSection(doc: Doc, text: string) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.4);
  const y = doc.y; const w = pdfW(doc);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(hash(BRAND.mid)).text(text.toUpperCase(), doc.page.margins.left, y, { lineBreak: false });
  doc.moveTo(doc.page.margins.left, y + 13).lineTo(doc.page.margins.left + w, y + 13).lineWidth(1.2).strokeColor(hash(BRAND.accent)).stroke().lineWidth(1);
  doc.y = y + 20;
}

/** Tinted panel of label/value pairs in `cols` columns. */
export function pdfKeyValues(doc: Doc, rows: [string, string][], cols = 2) {
  const left = doc.page.margins.left; const w = pdfW(doc); const colW = w / cols; const per = Math.ceil(rows.length / cols); const rowH = 16; const h = per * rowH + 10;
  if (doc.y + h > doc.page.height - 60) doc.addPage();
  const y0 = doc.y;
  doc.save().roundedRect(left, y0, w, h, 4).fill(hash(BRAND.panel)).restore();
  rows.forEach(([k, v], i) => {
    const x = left + 10 + Math.floor(i / per) * colW; const y = y0 + 6 + (i % per) * rowH;
    doc.font('Helvetica').fontSize(8).fillColor(hash(BRAND.mute)).text(fit(doc, k, 110), x, y + 1, { width: 112, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(hash(BRAND.ink)); doc.text(fit(doc, v, colW - 134), x + 116, y, { width: colW - 132, lineBreak: false });
  });
  doc.y = y0 + h + 8; doc.x = left;
}

export interface PdfCol { label: string; width: number; align?: 'left' | 'right' | 'center' }

/** Truncates text with an ellipsis so it never spills into the next column. */
function fit(doc: Doc, text: string, width: number) {
  if (doc.widthOfString(text) <= width) return text;
  let t = text;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Zebra table with a repeating header, optional totals row and status colouring. `statusCol` is the index of a status column.
 * Column widths come from the content: numbers are never cut off, text columns share what is left.
 */
export function pdfTable(doc: Doc, cols: PdfCol[], rows: string[][], opts: { totals?: string[]; statusCol?: number; onPage: () => void; fontSize?: number } ) {
  const left = doc.page.margins.left; const w = pdfW(doc); const fs = opts.fontSize ?? 8; const rowH = fs + 8;
  // 1. natural width of each column
  doc.font('Helvetica').fontSize(fs);
  const nat = cols.map((c, i) => {
    let m = 0;
    doc.font('Helvetica').fontSize(fs); for (const r of rows) m = Math.max(m, doc.widthOfString(r[i] ?? ''));
    if (opts.totals) { doc.font('Helvetica-Bold').fontSize(fs + 0.5); m = Math.max(m, doc.widthOfString(opts.totals[i] ?? '')); }
    return m + 12;
  });
  // Only long free text (names, descriptions) may be squeezed; numbers, dates, ids and statuses keep their natural width.
  const numeric = cols.map((c, i) => c.align === 'right' || c.align === 'center' || nat[i]! <= 96);
  const headW = cols.map((c) => { doc.font('Helvetica-Bold').fontSize(fs); return doc.widthOfString(c.label) + 10; });
  const minW = cols.map((_, i) => (numeric[i] ? Math.max(nat[i]!, Math.min(headW[i]!, 54)) : Math.min(Math.max(nat[i]!, 30), 30)));
  let widths = cols.map((c, i) => (numeric[i] ? minW[i]! : Math.min(Math.max(nat[i]!, Math.min(headW[i]!, 54)), c.width * 3.2)));
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum <= w) { const extra = w - sum; const weight = cols.reduce((a, c) => a + c.width, 0); widths = widths.map((x, i) => x + (extra * cols[i]!.width) / weight); }
  else { // squeeze the text columns first, never the numbers
    const fixed = widths.reduce((a, x, i) => a + (numeric[i] ? x : 0), 0); const flex = widths.reduce((a, x, i) => a + (numeric[i] ? 0 : x), 0);
    const room = Math.max(w - fixed, 40); widths = widths.map((x, i) => (numeric[i] ? x : Math.max(70, (x / flex) * room)));
    const tot = widths.reduce((a, b) => a + b, 0); if (tot > w) widths = widths.map((x) => (x * w) / tot);
  }
  const twoLine = cols.some((c, i) => { doc.font('Helvetica-Bold').fontSize(fs); return doc.widthOfString(c.label) > widths[i]! - 8; });
  const headH = twoLine ? rowH * 2 : rowH + 4;
  const head = () => {
    const y = doc.y; doc.save().roundedRect(left, y, w, headH, 3).fill(hash(BRAND.mid)).restore();
    let x = left; doc.font('Helvetica-Bold').fontSize(fs).fillColor('#FFFFFF');
    cols.forEach((c, i) => { doc.text(c.label, x + 4, y + (twoLine ? 4 : 5), { width: widths[i]! - 8, height: headH - 4, align: c.align ?? 'left', ellipsis: true }); x += widths[i]!; });
    doc.y = y + headH + 3;
  };
  const room = () => doc.y > doc.page.height - 58;
  head();
  rows.forEach((cells, ri) => {
    if (room()) { doc.addPage(); opts.onPage(); head(); }
    const y = doc.y;
    if (ri % 2 === 1) doc.save().rect(left, y - 2, w, rowH).fill(hash(BRAND.zebra)).restore();
    let x = left;
    cells.forEach((t, i) => {
      const sc = opts.statusCol === i ? statusColor(t) : null;
      doc.font(sc ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).fillColor(sc ? hash(sc) : hash(BRAND.ink));
      doc.text(cols[i]!.align === 'right' ? t : fit(doc, t, widths[i]! - 8), x + 4, y + 1, { width: widths[i]! - 8, align: cols[i]!.align ?? 'left', lineBreak: false }); x += widths[i]!;
    });
    doc.y = y + rowH;
  });
  doc.moveTo(left, doc.y - 1).lineTo(left + w, doc.y - 1).lineWidth(0.6).strokeColor(hash(BRAND.line)).stroke().lineWidth(1);
  if (opts.totals) {
    if (room()) { doc.addPage(); opts.onPage(); }
    const y = doc.y + 2; doc.save().rect(left, y, w, rowH + 4).fill(hash(BRAND.panel)).restore();
    doc.moveTo(left, y).lineTo(left + w, y).lineWidth(1.4).strokeColor(hash(BRAND.dark)).stroke().lineWidth(1);
    let x = left; doc.font('Helvetica-Bold').fontSize(fs + 0.5).fillColor(hash(BRAND.dark));
    opts.totals.forEach((t, i) => { doc.text(cols[i]!.align === 'right' ? t : fit(doc, t, widths[i]! - 8), x + 4, y + 5, { width: widths[i]! - 8, align: cols[i]!.align ?? 'left', lineBreak: false }); x += widths[i]!; });
    doc.y = y + rowH + 10;
  }
  doc.x = left;
}

/** Stamps "Generated ... / Page x of y" on every page. Call once, before doc.end(); the doc must use bufferPages. */
export function pdfFooters(doc: Doc, note: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const left = doc.page.margins.left; const w = pdfW(doc); const y = doc.page.height - 32;
    doc.page.margins.bottom = 0; // allow text inside the bottom margin without adding a page
    doc.moveTo(left, y - 6).lineTo(left + w, y - 6).lineWidth(0.6).strokeColor(hash(BRAND.line)).stroke().lineWidth(1);
    doc.font('Helvetica').fontSize(7).fillColor(hash(BRAND.mute)); doc.text(fit(doc, note, w - 90), left, y, { width: w - 80, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + w - 80, y, { width: 80, align: 'right', lineBreak: false });
  }
}
