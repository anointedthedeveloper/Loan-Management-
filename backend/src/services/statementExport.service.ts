import type { Statement } from './statement.service.js';
import { windowOpens } from '../config/loanOptions.js';
import { BRAND, pdfBand, pdfFooters, pdfKeyValues, pdfRunningHead, pdfSection, pdfTable, utcDateOf, xlFooter, xlHeaderRow, xlKeyValues, xlPrint, xlStyleBody, xlTitleBlock, xlTotalsRow } from './exportStyle.js';

const NAIRA = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => NAIRA.format(n);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const dmy = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const clientLines = (s: Statement): [string, string][] => [['IPPIS Number', s.client.ippisNumber ?? '—'], ['Client Name', s.client.name], ['Ministry / Organization', s.client.ministry ?? '—'], ['Client ID', s.client.customerId], ['Phone', s.client.phone]];
const loanLines = (l: Statement['loans'][number]['loan']): [string, string][] => [
  ['Loan ID', l.loanId], ['Amount Taken', money(l.amountTaken)], ['Principal', money(l.principal)], ['Monthly Interest', money(l.monthlyInterest)], ['Interest (one-time)', money(l.interest)], ['Total Loan', money(l.totalLoan)],
  ['EMI (per period)', `${money(l.emi)} × ${l.numberOfInstallments}`], ['Payment Date', dmy(l.paymentDate)], ['First Repayment', dmy(l.firstRepaymentDate)], ['Final Due Date', dmy(l.finalDueDate)],
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


type StLoan = Statement['loans'][number];
const stamp = () => `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const dateCell = (d: Date | null | undefined) => (d ? utcDateOf(new Date(d)) : null);
const clientPairs = (s: Statement): [string, string][] => clientLines(s);
const loanPairs = (l: StLoan['loan']): [string, string][] => loanLines(l);
const addTable = (ws: import('exceljs').Worksheet, head: string[], kinds: ('text' | 'money' | 'date' | 'number' | 'status')[], rows: unknown[][], totals?: unknown[]) => {
  const h = ws.addRow(head); xlHeaderRow(h, head.length);
  const first = ws.rowCount + 1;
  for (const r of rows) ws.addRow(r);
  const last = ws.rowCount;
  xlStyleBody(ws, first, last, kinds);
  let t: import('exceljs').Row | undefined;
  if (totals) { t = ws.addRow(totals); xlTotalsRow(t, head.length, kinds); }
  return { head: h, first, last, totals: t };
};

export async function statementToXlsx(s: Statement, generatedBy: string): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = s.company.name; wb.created = new Date();
  for (const l of s.loans.length ? s.loans : [null]) {
    const ws = wb.addWorksheet(l ? l.loan.loanId : 'Statement');
    xlTitleBlock(ws, s.company.name, 'Account Statement', periodText(s).replace('Period: ', 'Period: '), 6);
    xlKeyValues(ws, 'Client information', clientPairs(s), 6);
    if (l) {
      xlKeyValues(ws, `Loan information · ${l.loan.loanId}`, loanPairs(l.loan).slice(1), 6);
      const t = addTable(ws, ['Transaction Date', 'Reference Number', 'Description', 'Debit (DR)', 'Credit (CR)', 'Balance'], ['date', 'text', 'text', 'money', 'money', 'money'],
        l.rows.map((r) => [dateCell(r.date), r.reference, r.description, r.debit || null, r.credit || null, r.balance]), ['', '', 'Totals / closing balance', l.totals.debit, l.totals.credit, l.totals.closingBalance]);
      for (let r = t.first; r <= t.last; r++) ws.getCell(r, 3).alignment = { vertical: 'middle', wrapText: true };
      ws.views = [{ showGridLines: false }];
      xlPrint(ws, { company: s.company.name, headerRow: t.head.number, landscape: false });
    } else ws.addRow(['No loan transactions to report.']).getCell(1).font = { italic: true };
    xlFooter(ws, `${stamp()} by ${generatedBy}. Balance = amount still owed (debits less credits).`, 6);
    [18, 22, 58, 17, 17, 17].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    if (l) {
      // Monthly breakdown: the repayment schedule month by month, with what has been paid against each month.
      const ms = wb.addWorksheet(`${l.loan.loanId} monthly`.slice(0, 31));
      xlTitleBlock(ms, s.company.name, `Monthly breakdown · ${l.loan.loanId}`, `${s.client.name} (IPPIS ${s.client.ippisNumber ?? '–'})  ·  Total loan ${money(l.loan.totalLoan)}  ·  EMI ${money(l.loan.emi)}`, 9);
      const t = addTable(ms, ['No.', 'Month', 'Due Date', 'EMI (Repayment)', 'Principal part', 'Interest part', 'Paid', 'Remaining', 'Status'], ['number', 'text', 'date', 'money', 'money', 'money', 'money', 'money', 'status'],
        l.schedule.map((m) => [m.number, m.month, dateCell(m.dueDate), m.emi, m.principal, m.interest, m.paid, m.remaining, m.status.replace(/_/g, ' ')]));
      if (l.schedule.length) {
        const tr = ms.addRow(['', '', 'Totals']); xlTotalsRow(tr, 9, ['text', 'text', 'text', 'money', 'money', 'money', 'money', 'money', 'text']);
        ['D', 'E', 'F', 'G', 'H'].forEach((col) => { tr.getCell(col).value = { formula: `SUM(${col}${t.first}:${col}${t.last})` }; });
      }
      xlFooter(ms, `${stamp()} by ${generatedBy}.`, 9);
      [7, 14, 15, 18, 16, 16, 16, 16, 15].forEach((w, i) => { ms.getColumn(i + 1).width = w; });
      ms.views = [{ showGridLines: false, state: 'frozen', ySplit: t.head.number }];
      xlPrint(ms, { company: s.company.name, headerRow: t.head.number });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const scheduleCols = [{ label: 'No.', width: 0.5, align: 'center' as const }, { label: 'Month', width: 1 }, { label: 'Due date', width: 1.1 }, { label: 'EMI', width: 1.1, align: 'right' as const }, { label: 'Principal', width: 1.1, align: 'right' as const },
  { label: 'Interest', width: 1.1, align: 'right' as const }, { label: 'Paid', width: 1.1, align: 'right' as const }, { label: 'Remaining', width: 1.1, align: 'right' as const }, { label: 'Status', width: 1 }];
const scheduleRows = (l: StLoan) => l.schedule.map((m) => [String(m.number), m.month, dmy(m.dueDate), money(m.emi), money(m.principal), money(m.interest), money(m.paid), money(m.remaining), m.status.replace(/_/g, ' ')]);
const scheduleTotals = (l: StLoan) => { const t = (k: 'emi' | 'principal' | 'interest' | 'paid' | 'remaining') => money(l.schedule.reduce((a, m) => a + m[k], 0)); return ['', '', 'Totals', t('emi'), t('principal'), t('interest'), t('paid'), t('remaining'), '']; };

export async function statementToPdf(s: Statement, generatedBy: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const head = () => pdfRunningHead(doc, s.company.name, 'Account Statement');
    pdfBand(doc, s.company.name, 'Account Statement', [s.company.address, s.company.phone, s.company.email]);
    doc.font('Helvetica').fontSize(8.5).fillColor(`#${BRAND.mute}`).text(periodText(s), 36, doc.y);
    doc.moveDown(0.5);
    pdfSection(doc, 'Client information'); pdfKeyValues(doc, clientLines(s));
    const cols = [{ label: 'Date', width: 62 }, { label: 'Reference', width: 82 }, { label: 'Description', width: 190 }, { label: 'Debit (DR)', width: 72, align: 'right' as const }, { label: 'Credit (CR)', width: 72, align: 'right' as const }, { label: 'Balance', width: 78, align: 'right' as const }];
    for (const l of s.loans) {
      if (doc.y > doc.page.height - 260) { doc.addPage(); head(); }
      pdfSection(doc, `Loan information · ${l.loan.loanId}`); pdfKeyValues(doc, loanLines(l.loan).slice(1));
      pdfSection(doc, 'Account / transaction statement');
      pdfTable(doc, cols, l.rows.map((r) => [ymd(r.date), r.reference, r.description, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)]), { totals: ['', '', 'Totals / closing balance', money(l.totals.debit), money(l.totals.credit), money(l.totals.closingBalance)], onPage: head, fontSize: 7.5 });
      if (l.schedule.length) {
        if (doc.y > doc.page.height - 200) { doc.addPage(); head(); }
        pdfSection(doc, 'Monthly breakdown');
        pdfTable(doc, scheduleCols, scheduleRows(l), { totals: scheduleTotals(l), statusCol: 8, onPage: head, fontSize: 7.5 });
      }
    }
    if (!s.loans.length) doc.font('Helvetica').fontSize(10).fillColor(`#${BRAND.mute}`).text('No loan transactions to report.');
    if (s.loans.length > 1) { pdfSection(doc, 'All loans'); pdfKeyValues(doc, [['Total debit', money(s.summary.totalDebit)], ['Total credit', money(s.summary.totalCredit)], ['Balance owed', money(s.summary.closingBalance)]], 3); }
    pdfFooters(doc, `${s.company.name} · ${stamp()} by ${generatedBy} · Balance = amount still owed (debits less credits)`);
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
  const monthly = l.loan.frequency === 'monthly';
  const wb = new ExcelJS.Workbook(); wb.creator = s.company.name; wb.created = new Date();
  const ws = wb.addWorksheet(`${l.loan.loanId} schedule`.slice(0, 31));
  xlTitleBlock(ws, s.company.name, `Repayment schedule · ${l.loan.loanId}`, monthly ? 'Window opens on the 25th · due on the 30th (28/29 in February)' : '', 10);
  xlKeyValues(ws, 'Client information', clientPairs(s), 10);
  xlKeyValues(ws, 'Loan information', loanPairs(l.loan), 10);
  const t = addTable(ws, SCHED_HEAD, ['number', 'text', 'date', 'date', 'money', 'money', 'money', 'money', 'money', 'status'],
    l.schedule.map((m) => [m.number, m.month, monthly ? dateCell(windowOpens(new Date(m.dueDate))) : null, dateCell(m.dueDate), m.emi, m.principal, m.interest, m.paid, m.remaining, m.status.replace(/_/g, ' ')]));
  if (l.schedule.length) {
    const tr = ws.addRow(['', '', '', 'Totals']); xlTotalsRow(tr, 10, ['text', 'text', 'text', 'text', 'money', 'money', 'money', 'money', 'money', 'text']);
    ['E', 'F', 'G', 'H', 'I'].forEach((c) => { tr.getCell(c).value = { formula: `SUM(${c}${t.first}:${c}${t.last})` }; });
  }
  xlFooter(ws, `${stamp()} by ${generatedBy}.`, 10);
  [26, 14, 20, 15, 18, 16, 16, 16, 16, 15].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  xlPrint(ws, { company: s.company.name, headerRow: t.head.number });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function scheduleToPdf(s: Statement, generatedBy: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const l = oneLoan(s);
  const monthly = l.loan.frequency === 'monthly';
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const head = () => pdfRunningHead(doc, s.company.name, `Repayment schedule · ${l.loan.loanId}`);
    pdfBand(doc, s.company.name, 'Repayment schedule', [s.company.address, s.company.phone, s.company.email]);
    pdfSection(doc, 'Client information'); pdfKeyValues(doc, clientLines(s));
    pdfSection(doc, `Loan information · ${l.loan.loanId}`); pdfKeyValues(doc, loanLines(l.loan).slice(1));
    if (monthly) doc.font('Helvetica-Oblique').fontSize(8).fillColor(`#${BRAND.mute}`).text('Payment window opens on the 25th; each installment is due on the 30th (28/29 in February).', 36, doc.y);
    doc.moveDown(0.4);
    pdfSection(doc, 'Schedule');
    pdfTable(doc, scheduleCols, scheduleRows(l), { totals: scheduleTotals(l), statusCol: 8, onPage: head, fontSize: 8 });
    pdfFooters(doc, `${s.company.name} · ${stamp()} by ${generatedBy}`);
    doc.end();
  });
}
