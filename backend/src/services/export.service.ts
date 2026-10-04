import type { Col, ReportResult, Row } from './report.service.js';

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
  const ws = wb.addWorksheet(r.title.slice(0, 30));
  ws.addRow([`${company} — ${r.title}`]).font = { bold: true, size: 14 };
  ws.addRow([`Period: ${r.from ? ymd(r.from) : 'start'} to ${r.to ? ymd(r.to) : 'today'}`]);
  ws.addRow([]);
  const head = ws.addRow(r.columns.map((c) => c.label)); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D2E' } }; });
  const col = (key: string) => { const i = r.columns.findIndex((c) => c.key === key); return i < 0 ? null : ws.getColumn(i + 1).letter; };
  const L = r.key === 'loan-book' ? { bank: col('bankPayment'), bf: col('balanceBF'), gross: col('grossPayment'), prin: col('principal'), int: col('interest'), loan: col('grossLoan'), emi: col('emi'), tenor: col('tenor'), repaid: col('repaid'), bal: col('balance'),
    m1: r.columns.find((c) => c.key.startsWith('m_')) ? col(r.columns.find((c) => c.key.startsWith('m_'))!.key) : null, mN: [...r.columns].reverse().find((c) => c.key.startsWith('m_')) ? col([...r.columns].reverse().find((c) => c.key.startsWith('m_'))!.key) : null } : null;
  const firstDataRow = ws.rowCount + 1;
  for (const row of r.rows) {
    const x = ws.addRow(r.columns.map((c) => { const v = raw(c, row[c.key]!); return typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v; }));
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
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c) => raw(c, r.totals![c.key] ?? ''))); t.font = { bold: true };
    if (L && r.rows.length) r.columns.forEach((c, i) => { if (r.totals![c.key] !== undefined && c.type === 'money') { const cl = ws.getColumn(i + 1).letter; t.getCell(i + 1).value = { formula: `SUM(${cl}${firstDataRow}:${cl}${lastDataRow})`, result: Number(r.totals![c.key]) || 0 }; } });
  }
  if (L) { ws.views = [{ state: 'frozen', xSplit: 3, ySplit: head.number }]; ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: r.columns.length } }; }
  r.columns.forEach((c, i) => { const cc = ws.getColumn(i + 1); cc.width = Math.max(12, Math.min(c.label.length + 4, c.key === 'clientName' ? 34 : 22)); if (c.type === 'money') cc.numFmt = '#,##0.00'; if (c.type === 'date') cc.numFmt = 'yyyy-mm-dd'; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(r: ReportResult, company: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 60; const n = r.columns.length;
    const weights = r.columns.map((c) => (c.type === 'money' ? 1.2 : c.type === 'text' ? 1.6 : 1)); const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * W);
    const header = () => {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#0B3D2E').text(`${company} — ${r.title}`, 30, 30);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Period: ${r.from ? ymd(r.from) : 'start'} to ${r.to ? ymd(r.to) : 'today'}   ·   Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
      doc.moveDown(0.8);
    };
    const line = (cells: string[], bold = false, y = doc.y) => {
      let x = 30; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#111');
      cells.forEach((t, i) => { const right = r.columns[i]!.type === 'money' || r.columns[i]!.type === 'number'; doc.text(t, x, y, { width: widths[i]! - 6, align: right ? 'right' : 'left', lineBreak: false, ellipsis: true }); x += widths[i]!; });
      doc.y = y + 14;
    };
    header(); line(r.columns.map((c) => c.label), true);
    doc.moveTo(30, doc.y - 3).lineTo(30 + W, doc.y - 3).strokeColor('#999').stroke();
    for (const row of r.rows) {
      if (doc.y > doc.page.height - 50) { doc.addPage(); header(); line(r.columns.map((c) => c.label), true); }
      line(r.columns.map((c) => shown(c, row[c.key]!)));
    }
    if (r.totals) line(r.columns.map((c) => shown(c, r.totals![c.key] ?? '')), true);
    if (!r.rows.length) doc.fontSize(10).fillColor('#666').text('No records for this period.', 30);
    void n; doc.end();
  });
}
