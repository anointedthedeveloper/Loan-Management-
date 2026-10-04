import type { Col, ReportResult, Row } from './report.service.js';
import { BRAND, pdfBand, pdfFooters, pdfRunningHead, pdfTable, utcDateOf, xlFooter, xlHeaderRow, xlPrint, xlStyleBody, xlTitleBlock, xlTotalsRow } from './exportStyle.js';

const NAIRA = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ''));
const humanize = (v: string) => v.replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase());

/** Plain value used by CSV/Excel (numbers stay numeric). */
const raw = (c: Col, v: Row[string]) => (v === null || v === undefined ? '' : c.type === 'date' ? ymd(v) : v);
/** Display text used by PDF. */
const shown = (c: Col, v: Row[string]) => (v === null || v === undefined || v === '' ? '' : c.type === 'money' ? NAIRA.format(Number(v)) : c.type === 'date' ? ymd(v) : c.type === 'status' ? humanize(String(v)) : String(v));

export function toCsv(r: ReportResult): string {
  const esc = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // neutralises spreadsheet formula injection
  const lines = [r.columns.map((c) => esc(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(raw(c, row[c.key]!))).join(','));
  if (r.totals) lines.push(r.columns.map((c) => esc(raw(c, r.totals![c.key] ?? ''))).join(','));
  return '﻿' + lines.join('\r\n');
}

export async function toXlsx(r: ReportResult, company: string): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = company;
  const ws = wb.addWorksheet(r.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 30));
  xlTitleBlock(ws, company, r.title, `Period: ${r.from ? ymd(r.from) : 'start'} to ${r.to ? ymd(r.to) : 'today'}`, r.columns.length);
  const head = ws.addRow(r.columns.map((c) => c.label)); xlHeaderRow(head, r.columns.length);
  const col = (key: string) => { const i = r.columns.findIndex((c) => c.key === key); return i < 0 ? null : ws.getColumn(i + 1).letter; };
  const L = r.key === 'loan-book' ? { bank: col('bankPayment'), bf: col('balanceBF'), gross: col('grossPayment'), prin: col('principal'), int: col('interest'), loan: col('grossLoan'), emi: col('emi'), tenor: col('tenor'), repaid: col('repaid'), bal: col('balance'),
    m1: r.columns.find((c) => c.key.startsWith('m_')) ? col(r.columns.find((c) => c.key.startsWith('m_'))!.key) : null, mN: [...r.columns].reverse().find((c) => c.key.startsWith('m_')) ? col([...r.columns].reverse().find((c) => c.key.startsWith('m_'))!.key) : null } : null;
  const firstDataRow = ws.rowCount + 1;
  for (const row of r.rows) {
    const x = ws.addRow(r.columns.map((c) => { const v = raw(c, row[c.key]!); if (c.type === 'date') return utcDateOf(v) ?? v; return typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v; }));
    if (!L) continue;
    // The calculator's own formulas, so the sheet can be audited and recalculated in Excel.
    const n = x.number; const calc = (row as any)._calc as { ded: number; rate: number } | null; const put = (k: string | null, formula: string, key: string) => { if (k) x.getCell(k).value = { formula, result: Number(row[key]) || 0 }; };
    if (calc) {
      const pct = `${Math.round(calc.rate * 1e6) / 1e4}%`;
      put(L.gross, calc.ded > 0 ? `ROUND(${L.bank}${n}/${Math.round((1 - calc.ded) * 1e6) / 1e6},2)` : `ROUND(${L.bank}${n},2)`, 'grossPayment');
      put(L.prin, `ROUND(${L.bf}${n}+${L.gross}${n},2)`, 'principal');
      put(L.int, `ROUND(${L.prin}${n}*${pct}*${L.tenor}${n},2)`, 'interest');
      put(L.loan, `ROUND(${L.prin}${n}+${L.prin}${n}*${pct}*${L.tenor}${n},2)`, 'grossLoan');
      put(L.emi, `ROUND((${L.prin}${n}+${L.prin}${n}*${pct}*${L.tenor}${n})/${L.tenor}${n},2)`, 'emi');
    }
    if (L.m1 && L.mN && !r.from && !r.to) put(L.repaid, `SUM(${L.m1}${n}:${L.mN}${n})`, 'repaid');
    put(L.bal, `ROUND(${L.loan}${n}-${L.repaid}${n},2)`, 'balance');
  }
  const lastDataRow = ws.rowCount;
  const kinds = r.columns.map((c) => (c.type === 'money' ? 'money' : c.type === 'date' ? 'date' : c.type === 'status' ? 'status' : c.type === 'number' ? 'number' : 'text')) as ('text' | 'money' | 'date' | 'number' | 'status')[];
  xlStyleBody(ws, firstDataRow, lastDataRow, kinds);
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c) => raw(c, r.totals![c.key] ?? ''))); xlTotalsRow(t, r.columns.length, kinds);
    if (L && r.rows.length) r.columns.forEach((c, i) => { if (r.totals![c.key] !== undefined && c.type === 'money') { const cl = ws.getColumn(i + 1).letter; t.getCell(i + 1).value = { formula: `SUM(${cl}${firstDataRow}:${cl}${lastDataRow})`, result: Number(r.totals![c.key]) || 0 }; } });
  }
  if (!r.rows.length) { const e = ws.addRow(['No records for this period.']); e.getCell(1).font = { italic: true, color: { argb: `FF${BRAND.mute}` } }; }
  xlFooter(ws, `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, r.columns.length);
  xlPrint(ws, { company, headerRow: head.number });
  ws.views = [{ showGridLines: false, state: 'frozen', xSplit: L ? 3 : 0, ySplit: head.number }];
  if (L) { ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: r.columns.length } }; }
  r.columns.forEach((c, i) => { const cc = ws.getColumn(i + 1); cc.width = c.type === 'money' ? 18 : c.type === 'date' ? 14 : c.type === 'status' ? 14 : c.type === 'number' ? 11 : Math.max(14, Math.min(c.label.length + 6, c.key === 'clientName' ? 34 : 30)); });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(r: ReportResult, company: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const wide = r.columns.length > 12; // wide reports (e.g. the loan book) get an A3 sheet and smaller type
    const doc = new PDFDocument({ size: wide ? 'A3' : 'A4', layout: 'landscape', margin: 32, bufferPages: true });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const period = `Period: ${r.from ? ymd(r.from) : 'start'} to ${r.to ? ymd(r.to) : 'today'}`;
    pdfBand(doc, company, r.title, [period]);
    const weights = r.columns.map((c) => (c.type === 'money' ? 1.25 : c.type === 'text' ? 1.7 : c.type === 'number' ? 0.7 : 1));
    const cols = r.columns.map((c, i) => ({ label: c.label, width: weights[i]!, align: (c.type === 'money' || c.type === 'number' ? 'right' : 'left') as 'left' | 'right' }));
    const statusCol = r.columns.findIndex((c) => c.type === 'status');
    const hasLabel = !!r.totals && Object.values(r.totals).some((v) => typeof v === 'string' && v !== '');
    if (!r.rows.length) doc.font('Helvetica').fontSize(10).fillColor(`#${BRAND.mute}`).text('No records for this period.');
    else pdfTable(doc, cols, r.rows.map((row) => r.columns.map((c) => shown(c, row[c.key]!))), { statusCol: statusCol >= 0 ? statusCol : undefined, totals: r.totals ? r.columns.map((c, i) => (i === Math.max(0, r.columns.findIndex((x) => x.type === 'text')) && !hasLabel ? 'Totals' : shown(c, r.totals![c.key] ?? ''))) : undefined, onPage: () => pdfRunningHead(doc, company, r.title), fontSize: wide ? 6.5 : 7.5 });
    if (r.truncated) doc.moveDown(0.5).font('Helvetica-Oblique').fontSize(8).fillColor(`#${BRAND.amber}`).text('Showing the first rows only. Narrow the date range to see the rest.');
    pdfFooters(doc, `${company} · ${r.title} · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    doc.end();
  });
}
