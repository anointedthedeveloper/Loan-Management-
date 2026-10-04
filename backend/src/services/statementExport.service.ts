import type { Statement } from './statement.service.js';
import { windowOpens } from '../config/loanOptions.js';

const NAIRA = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => NAIRA.format(n);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const dmy = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const clientLines = (s: Statement): [string, string][] => [['IPPIS Number', s.client.ippisNumber ?? '—'], ['Client Name', s.client.name], ['Ministry / Organization', s.client.ministry ?? '—'], ['Client ID', s.client.customerId], ['Phone', s.client.phone]];
const loanLines = (l: Statement['loans'][number]['loan']): [string, string][] => [
  ['Loan ID', l.loanId], ['Amount Taken', money(l.amountTaken)], ['Principal', money(l.principal)], ['Monthly Interest (principal x rate)', money(l.monthlyInterest)], ['Interest (one-time total)', money(l.interest)], ['Total Loan', money(l.totalLoan)],
  ['EMI (repayment per period)', `${money(l.emi)} × ${l.numberOfInstallments}`], ['Payment Date', dmy(l.paymentDate)], ['First Repayment Date', dmy(l.firstRepaymentDate)], ['Final Due Date', dmy(l.finalDueDate)],
];
const periodText = (s: Statement) => (s.period.from || s.period.to ? `Period: ${s.period.from ? dmy(s.period.from) : 'start'} to ${s.period.to ? dmy(s.period.to) : 'date'}` : 'Period: all transactions');

export function statementToCsv(s: Statement): string {
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const out: string[] = [esc(`${s.company.name} - Account Statement`), esc(periodText(s)), ''];
  for (const [k, v] of clientLines(s)) out.push(`${esc(k)},${esc(v)}`);
  for (const l of s.loans) {
    out.push('', ...loanLines(l.loan).map(([k, v]) => `${esc(k)},${esc(v)}`), '', 'Transaction Date,Reference Number,Description,Debit (DR),Credit (CR),Balance');
    for (const r of l.rows) out.push([ymd(r.date), r.reference, r.description, r.debit || '', r.credit || '', r.balance].map(esc).join(','));
    out.push(['', '', 'Totals', l.totals.debit, l.totals.credit, l.totals.closingBalance].map(esc).join(','));
  }
  return '﻿' + out.join('\r\n');
}

export async function statementToXlsx(s: Statement, generatedBy: string): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = s.company.name;
  for (const l of s.loans.length ? s.loans : [null]) {
    const ws = wb.addWorksheet(l ? l.loan.loanId : 'Statement');
    ws.addRow([`${s.company.name} - Account Statement`]).font = { bold: true, size: 14 };
    ws.addRow([periodText(s)]); ws.addRow([]);
    for (const [k, v] of clientLines(s)) ws.addRow([k, v]).getCell(1).font = { bold: true };
    if (l) {
      ws.addRow([]);
      for (const [k, v] of loanLines(l.loan)) ws.addRow([k, v]).getCell(1).font = { bold: true };
      ws.addRow([]);
      const head = ws.addRow(['Transaction Date', 'Reference Number', 'Description', 'Debit (DR)', 'Credit (CR)', 'Balance']);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D2E' } }; });
      for (const r of l.rows) ws.addRow([ymd(r.date), r.reference, r.description, r.debit || null, r.credit || null, r.balance]);
      ws.addRow(['', '', 'Totals', l.totals.debit, l.totals.credit, l.totals.closingBalance]).font = { bold: true };
    }
    ws.addRow([]); ws.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}`]);
    [14, 22, 56, 16, 16, 16].forEach((w, i) => { const c = ws.getColumn(i + 1); c.width = w; if (i >= 3) c.numFmt = '#,##0.00'; });
    if (l) {
      // Monthly breakdown: the repayment schedule month by month, with what has been paid against each month.
      const ms = wb.addWorksheet(`${l.loan.loanId} monthly`.slice(0, 31));
      ms.addRow([`${s.company.name} - Monthly breakdown - ${l.loan.loanId}`]).font = { bold: true, size: 14 };
      ms.addRow([`${s.client.name} (IPPIS ${s.client.ippisNumber ?? '-'}) · Total loan ${money(l.loan.totalLoan)} · EMI ${money(l.loan.emi)}`]); ms.addRow([]);
      const mh = ms.addRow(['No.', 'Month', 'Due Date', 'EMI (Repayment)', 'Principal part', 'Interest part', 'Paid', 'Remaining', 'Status']);
      mh.font = { bold: true, color: { argb: 'FFFFFFFF' } }; mh.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D2E' } }; });
      const first = ms.rowCount + 1;
      for (const m of l.schedule) ms.addRow([m.number, m.month, ymd(m.dueDate), m.emi, m.principal, m.interest, m.paid, m.remaining, m.status.replace(/_/g, ' ')]);
      const last = ms.rowCount;
      if (l.schedule.length) {
        const t = ms.addRow(['', '', 'Totals']); t.font = { bold: true };
        ['D', 'E', 'F', 'G', 'H'].forEach((col) => { t.getCell(col).value = { formula: `SUM(${col}${first}:${col}${last})` }; });
      }
      [6, 12, 14, 18, 16, 16, 16, 16, 16].forEach((w, i) => { const c = ms.getColumn(i + 1); c.width = w; if (i >= 3 && i <= 7) c.numFmt = '#,##0.00'; });
      ms.views = [{ state: 'frozen', ySplit: 4 }];
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function statementToPdf(s: Statement, generatedBy: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 72; const green = '#0B3D2E';
    const kv = (rows: [string, string][], cols = 2) => {
      const colW = W / cols; const startY = doc.y; const per = Math.ceil(rows.length / cols);
      rows.forEach(([k, v], i) => {
        const x = 36 + Math.floor(i / per) * colW; const y = startY + (i % per) * 15;
        doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(k, x, y, { width: 95, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(v, x + 98, y, { width: colW - 104, lineBreak: false, ellipsis: true });
      });
      doc.y = startY + per * 15 + 4;
    };
    doc.font('Helvetica-Bold').fontSize(16).fillColor(green).text(s.company.name, 36, 36);
    doc.font('Helvetica').fontSize(8).fillColor('#555').text([s.company.address, s.company.phone, s.company.email].filter(Boolean).join('  ·  ') || ' ');
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor('#111').text('ACCOUNT STATEMENT'); doc.font('Helvetica').fontSize(8).fillColor('#555').text(periodText(s)); doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text('CLIENT INFORMATION'); doc.moveDown(0.2); kv(clientLines(s)); doc.moveDown(0.4);
    const cols = [62, 88, W - 62 - 88 - 3 * 72, 72, 72, 72]; const heads = ['Date', 'Reference', 'Description', 'Debit (DR)', 'Credit (CR)', 'Balance'];
    const line = (cells: string[], bold = false) => {
      if (doc.y > doc.page.height - 60) { doc.addPage(); doc.y = 36; }
      const y = doc.y; let x = 36; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#111');
      cells.forEach((t, i) => { doc.text(t, x, y, { width: cols[i]! - 4, align: i >= 3 ? 'right' : 'left', lineBreak: i === 2, height: i === 2 ? 22 : undefined, ellipsis: true }); x += cols[i]!; });
      doc.y = Math.max(y + 12, doc.y > y + 22 ? y + 22 : doc.y); if (!bold && cells[2]!.length > 60) doc.y = y + 20;
    };
    for (const l of s.loans) {
      if (doc.y > doc.page.height - 220) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text(`LOAN INFORMATION - ${l.loan.loanId}`); doc.moveDown(0.2); kv(loanLines(l.loan).slice(1)); doc.moveDown(0.4);
      doc.save().rect(36, doc.y - 2, W, 14).fill(green).restore(); doc.fillColor('#fff'); const y0 = doc.y; let x = 36;
      doc.font('Helvetica-Bold').fontSize(7.5); heads.forEach((h, i) => { doc.fillColor('#fff').text(h, x + 2, y0 + 1, { width: cols[i]! - 6, align: i >= 3 ? 'right' : 'left', lineBreak: false }); x += cols[i]!; }); doc.y = y0 + 15;
      for (const r of l.rows) line([ymd(r.date), r.reference, r.description, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)]);
      doc.moveTo(36, doc.y).lineTo(36 + W, doc.y).strokeColor('#999').stroke(); doc.y += 3;
      line(['', '', 'TOTALS / CLOSING BALANCE', money(l.totals.debit), money(l.totals.credit), money(l.totals.closingBalance)], true); doc.moveDown(1);
    }
    if (!s.loans.length) doc.font('Helvetica').fontSize(10).fillColor('#666').text('No loan transactions to report.');
    if (s.loans.length > 1) { doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(`ALL LOANS - Total debit ${money(s.summary.totalDebit)}   Total credit ${money(s.summary.totalCredit)}   Balance ${money(s.summary.closingBalance)}`); }
    doc.moveDown(1).font('Helvetica').fontSize(7).fillColor('#777').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}. Balance = amount still owed (debits less credits).`);
    doc.end();
  });
}

/* ---------- repayment schedule (one loan): the month-by-month plan with what has been paid ---------- */
const SCHED_HEAD = ['No.', 'Month', 'Payment window opens', 'Due date', 'EMI (Repayment)', 'Principal part', 'Interest part', 'Paid', 'Remaining', 'Status'];
const schedRow = (m: Statement['loans'][number]['schedule'][number], monthly = true) => [m.number, m.month, monthly ? ymd(windowOpens(new Date(m.dueDate))) : '', ymd(m.dueDate), m.emi, m.principal, m.interest, m.paid, m.remaining, m.status.replace(/_/g, ' ')];
const oneLoan = (s: Statement) => { const l = s.loans[0]; if (!l) throw new Error('No loan'); return l; };

export function scheduleToCsv(s: Statement): string {
  const l = oneLoan(s);
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const out = [esc(`${s.company.name} - Repayment schedule - ${l.loan.loanId}`), '', ...clientLines(s).map(([k, v]) => `${esc(k)},${esc(v)}`), '', ...loanLines(l.loan).map(([k, v]) => `${esc(k)},${esc(v)}`), '', SCHED_HEAD.join(',')];
  for (const m of l.schedule) out.push(schedRow(m, l.loan.frequency === 'monthly').map(esc).join(','));
  out.push(['', '', '', 'Totals', ...[4, 5, 6, 7, 8].map((i) => l.schedule.reduce((a, m) => a + Number(schedRow(m)[i]), 0)), ''].map(esc).join(','));
  return '﻿' + out.join('\r\n');
}

export async function scheduleToXlsx(s: Statement, generatedBy: string): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const l = oneLoan(s);
  const wb = new ExcelJS.Workbook(); wb.creator = s.company.name;
  const ws = wb.addWorksheet(`${l.loan.loanId} schedule`.slice(0, 31));
  ws.addRow([`${s.company.name} - Repayment schedule - ${l.loan.loanId}`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  for (const [k, v] of clientLines(s)) ws.addRow([k, v]).getCell(1).font = { bold: true };
  ws.addRow([]);
  for (const [k, v] of loanLines(l.loan)) ws.addRow([k, v]).getCell(1).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(SCHED_HEAD); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D2E' } }; });
  const first = ws.rowCount + 1;
  for (const m of l.schedule) ws.addRow(schedRow(m, l.loan.frequency === 'monthly'));
  const last = ws.rowCount;
  if (l.schedule.length) { const t = ws.addRow(['', '', '', 'Totals']); t.font = { bold: true }; ['E', 'F', 'G', 'H', 'I'].forEach((c) => { t.getCell(c).value = { formula: `SUM(${c}${first}:${c}${last})` }; }); }
  ws.addRow([]); ws.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}`]);
  [34, 12, 20, 14, 18, 16, 16, 16, 16, 16].forEach((w, i) => { const c = ws.getColumn(i + 1); c.width = w; if (i >= 4 && i <= 8) c.numFmt = '#,##0.00'; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function scheduleToPdf(s: Statement, generatedBy: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const l = oneLoan(s);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 72; const green = '#0B3D2E';
    doc.font('Helvetica-Bold').fontSize(16).fillColor(green).text(s.company.name, 36, 36);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(`REPAYMENT SCHEDULE - ${l.loan.loanId}`);
    doc.font('Helvetica').fontSize(8.5).fillColor('#333').moveDown(0.4)
      .text(`${s.client.name}  ·  ${s.client.customerId}  ·  IPPIS ${s.client.ippisNumber ?? '—'}  ·  ${s.client.ministry ?? '—'}`)
      .text(`Amount taken ${money(l.loan.amountTaken)}  ·  Principal ${money(l.loan.principal)}  ·  Interest (one-time) ${money(l.loan.interest)}  ·  Total loan ${money(l.loan.totalLoan)}  ·  EMI ${money(l.loan.emi)} × ${l.loan.numberOfInstallments}`)
      .text(l.loan.frequency === 'monthly' ? 'Payment window opens on the 25th; each installment is due on the 30th (28/29 in February).' : ' ').moveDown(0.8);
    const widths = [28, 62, 82, 70, 82, 82, 82, 82, 82, W - 28 - 62 - 82 - 70 - 82 * 5]; const aligns = ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left'] as const;
    const row = (cells: string[], bold = false, fill?: string) => {
      if (doc.y > doc.page.height - 60) { doc.addPage(); doc.y = 36; }
      const y = doc.y; if (fill) doc.save().rect(36, y - 2, W, 14).fill(fill).restore();
      let x = 36; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(fill ? '#fff' : '#111');
      cells.forEach((t, i) => { doc.text(t, x + 2, y, { width: widths[i]! - 6, align: aligns[i], lineBreak: false, ellipsis: true }); x += widths[i]!; });
      doc.y = y + 14;
    };
    row(SCHED_HEAD, true, green);
    for (const m of l.schedule) row([String(m.number), m.month, l.loan.frequency === 'monthly' ? dmy(windowOpens(new Date(m.dueDate))) : '—', dmy(m.dueDate), money(m.emi), money(m.principal), money(m.interest), money(m.paid), money(m.remaining), m.status.replace(/_/g, ' ')]);
    const tot = (k: 'emi' | 'principal' | 'interest' | 'paid' | 'remaining') => money(l.schedule.reduce((a, m) => a + m[k], 0));
    doc.moveTo(36, doc.y).lineTo(36 + W, doc.y).strokeColor('#999').stroke(); doc.y += 3;
    row(['', '', '', 'TOTALS', tot('emi'), tot('principal'), tot('interest'), tot('paid'), tot('remaining'), ''], true);
    doc.moveDown(1).font('Helvetica').fontSize(7).fillColor('#777').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}.`);
    doc.end();
  });
}
