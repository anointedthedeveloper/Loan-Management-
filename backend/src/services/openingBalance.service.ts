import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { Customer } from '../models/Customer.js';
import { Loan } from '../models/Loan.js';
import { LoanProduct } from '../models/LoanProduct.js';
import { MonthlyUpload } from '../models/MonthlyUpload.js';
import { AppError } from '../utils/AppError.js';
import { AUDIT } from '../config/auditActions.js';
import { LIVE_LOAN_STATUSES } from '../config/loanOptions.js';
import { auditAs } from './AuditService.js';
import { buildDraft, createLoanRecord, approveLoan } from './loan.service.js';
import { ensureSequenceAtLeast } from '../models/Counter.js';
import { nextCustomerId, serialize as serializeCustomer } from './customer.service.js';
import type { Actor } from '../types/index.js';
import type { UploadPerms } from './monthlyUpload.service.js';

/**
 * Opening balances: "what each customer owes as at <date>", brought in without any loan history.
 * Each balance becomes a loan (type "opening") of that amount at 0% interest, so the customer can be repaid against it,
 * topped up (the balance is liquidated into the new loan) and shown in every report. No cash is paid out: the ledger gets
 * a non-cash "Opening balance" entry. Accountants' uploads wait for the CEO's approval like any other loan.
 * Sheet columns: Client ID, Clients Name, IPPIS NO, Ministry, Balance as at <date> (optional: Tenor, EMI).
 */
interface Line { row: number; clientId: number | null; name: string; ippis: string; ministry: string; balance: number | null; tenor: number | null }
export interface BalanceRow { row: number; name: string; clientId: string | null; ippis: string; matchedName?: string; customerRef?: string; isNewCustomer?: boolean; balance: number | null; tenor: number; action: 'opening-balance' | 'skipped' | 'error'; errors: string[]; warnings: string[]; _work?: { customer?: any; newCustomer?: { name: string; ippis: string; ministry: string; clientNo?: number }; balance: number; tenor: number } }

const clean = (v: unknown) => (v === null || v === undefined ? '' : String(typeof v === 'object' && v && 'result' in (v as any) ? (v as any).result ?? '' : typeof v === 'object' && v && 'text' in (v as any) ? (v as any).text : v).replace(/\s+/g, ' ').trim());
const num = (v: unknown) => { if (v && typeof v === 'object' && 'result' in (v as any)) v = (v as any).result; const s = clean(v).replace(/[,₦\s]/g, ''); return s === '' || isNaN(+s) ? null : +s; };
const ippisOf = (v: unknown) => clean(v).replace(/\s+/g, '').replace(/\.0+$/, '').toUpperCase();
const clientNo = (raw: string) => { const m = /^(?:PTC[-\s]?)?0*(\d+)$/i.exec(raw.trim()); return m ? +m[1]! : null; };
const pad = (n: number) => `PTC-${String(n).padStart(6, '0')}`;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-'/])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Balance as at 30 Sep, 2026" -> 2026-09-30 */
export function dateInHeader(text: string): Date | null {
  const m = /(\d{1,2})\s*(?:st|nd|rd|th)?[\s,.\-]*([a-z]{3})[a-z]*[\s,.\-]*(\d{4})/i.exec(text);
  const mo = m ? MONTHS.indexOf(m[2]!.toLowerCase()) : -1;
  return m && mo >= 0 ? new Date(Date.UTC(+m[3]!, mo, +m[1]!)) : null;
}

async function readBalances(buf: Buffer): Promise<{ lines: Line[]; asAt: Date | null }> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw AppError.badRequest('This is not an Excel (.xlsx) file', 'UPLOAD_BAD_FILE'); }
  const ws = wb.worksheets[0];
  if (!ws) throw AppError.badRequest('The workbook is empty', 'UPLOAD_BAD_FILE');
  let headRow = 0;
  ws.eachRow((r, n) => { if (!headRow) r.eachCell((c) => { if (!headRow && /^(clients? name|ippis( no)?|clients? id)$/i.test(clean(c.value))) headRow = n; }); });
  if (!headRow) throw AppError.badRequest('Could not find the header row (Client ID, Clients Name, IPPIS NO, Balance).', 'UPLOAD_BAD_FILE');
  const head = new Map<string, number>(); ws.getRow(headRow).eachCell((c, i) => head.set(clean(c.value).toLowerCase(), i));
  const find = (...needles: string[]) => { for (const n of needles) { const e = head.get(n); if (e) return e; } for (const [k, i] of head) if (needles.some((n) => k.startsWith(n))) return i; return undefined; };
  const col = { id: find('client id', 'clients id'), name: find('clients name', 'client name', 'name'), ippis: find('ippis'), min: find('ministry', 'aaa ministry'), bal: find('balance', 'outstanding'), tenor: find('tenor') };
  // the ministry header can carry stray text ("AAA MINISTRY2"), so look for the word anywhere
  if (!col.min) for (const [k, i] of head) if (k.includes('ministry')) col.min = i;
  if (!col.bal) throw AppError.badRequest('Could not find the balance column (a header starting with "Balance").', 'UPLOAD_BAD_FILE');
  if (!col.id && !col.ippis) throw AppError.badRequest('The sheet needs a Client ID or IPPIS NO column.', 'UPLOAD_BAD_FILE');
  let asAt: Date | null = null; for (const [k, i] of head) if (i === col.bal) asAt = dateInHeader(k);
  const lines: Line[] = [];
  ws.eachRow((r, n) => {
    if (n <= headRow) return;
    const g = (i?: number) => (i ? r.getCell(i).value : null);
    const name = clean(g(col.name)); const idRaw = clean(g(col.id)); const ippis = ippisOf(g(col.ippis));
    if (!name && !idRaw && !ippis) return;
    if (/^(total|generated|grand)/i.test(name)) return;
    lines.push({ row: n, clientId: clientNo(idRaw), name, ippis, ministry: clean(g(col.min)).toUpperCase(), balance: num(g(col.bal)), tenor: num(g(col.tenor)) });
  });
  if (!lines.length) throw AppError.badRequest('The sheet has no rows', 'UPLOAD_EMPTY');
  return { lines, asAt };
}

export async function planBalances(buf: Buffer, perms: UploadPerms, asAtParam?: string) {
  const { lines, asAt: headerDate } = await readBalances(buf);
  const asAt = asAtParam && /^\d{4}-\d{2}-\d{2}$/.test(asAtParam) ? new Date(`${asAtParam}T00:00:00Z`) : headerDate;
  if (!asAt) throw AppError.badRequest('The balance date is missing. Put it in the balance column header ("Balance as at 30 Sep, 2026") or choose it on the page.', 'UPLOAD_NO_DATE');
  const product = await LoanProduct.findOne({ isActive: true, allowedFrequencies: 'monthly' }).sort({ createdAt: 1 });
  if (!product) throw AppError.badRequest('Create an active monthly loan product first (Loan products).', 'NO_PRODUCT');
  const ids = lines.map((l) => l.clientId).filter((x): x is number => !!x); const ippisList = lines.map((l) => l.ippis).filter(Boolean);
  const customers = await Customer.find({ isArchived: false, $or: [{ customerId: { $in: ids.map(pad) } }, { legacyId: { $in: ids.map(String) } }, { 'employment.ippisNumber': { $in: ippisList } }] });
  const byRef = new Map(customers.map((c) => [c.customerId, c])); const byLegacy = new Map(customers.filter((c) => c.legacyId).map((c) => [String(c.legacyId), c]));
  const byIppis = new Map(customers.filter((c) => c.employment?.ippisNumber).map((c) => [String(c.employment!.ippisNumber).toUpperCase(), c]));
  const open = await Loan.find({ customer: { $in: customers.map((c) => c._id) }, status: { $in: ['pending', 'approved', ...LIVE_LOAN_STATUSES] } }).select('customer loanId status');
  const openBy = new Map<string, any>(); for (const l of open) if (!openBy.has(String(l.customer))) openBy.set(String(l.customer), l);
  const seen = new Set<string>(); const seenIppis = new Set<string>(); const seenNo = new Set<number>(); const rows: BalanceRow[] = [];
  for (const s of lines) {
    const p: BalanceRow = { row: s.row, name: s.name, clientId: s.clientId ? String(s.clientId) : null, ippis: s.ippis, balance: s.balance, tenor: s.tenor && Number.isInteger(s.tenor) && s.tenor > 0 ? s.tenor : 1, action: 'error', errors: [], warnings: [] };
    rows.push(p); const err = (m: string) => p.errors.push(m);
    if (s.balance === null) { p.action = 'skipped'; p.warnings.push('No balance in the row; nothing to record.'); continue; }
    if (s.balance < 0) { err('The balance cannot be negative.'); continue; }
    if (s.balance === 0) { p.action = 'skipped'; p.warnings.push('Balance is 0; nothing owed, so nothing is recorded.'); continue; }
    if (s.tenor !== null && !(Number.isInteger(s.tenor) && s.tenor > 0)) p.warnings.push('Tenor is not a whole number of months; the balance is set up as one payment.');
    // IPPIS first, then the client number
    const a = s.clientId ? byRef.get(pad(s.clientId)) ?? byLegacy.get(String(s.clientId)) : undefined; const b = s.ippis ? byIppis.get(s.ippis) : undefined;
    if (a && b && String(a._id) !== String(b._id)) p.warnings.push(`Client ${s.clientId} belongs to ${a.fullName}, but IPPIS ${s.ippis} is ${b.fullName}'s. The IPPIS decides.`);
    let cust: any = b ?? a;
    if (!cust) {
      if (!s.name) { err('The row has no client number, IPPIS or name.'); continue; }
      if (s.clientId && seenNo.has(s.clientId)) { err(`Client number ${s.clientId} is used twice in the sheet.`); continue; }
      if (s.ippis && (seenIppis.has(s.ippis) || await Customer.exists({ isArchived: false, 'employment.ippisNumber': s.ippis }))) { err(`IPPIS ${s.ippis} is used twice.`); continue; }
      const same = s.ippis ? [] : await Customer.find({ isArchived: false, fullName: new RegExp(`^${titleCase(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}$`, 'i') });
      if (same.length > 1) { err(`More than one customer is called ${titleCase(s.name)}. Put the Client ID in the row.`); continue; }
      if (same.length === 1) { cust = same[0]; p.warnings.push('Matched by name only.'); const o = await Loan.findOne({ customer: cust._id, status: { $in: ['pending', 'approved', ...LIVE_LOAN_STATUSES] } }).select('loanId status'); if (o) openBy.set(String(cust._id), o); }
      else if (!perms.canCreateCustomers) { err('This customer is not in the portal and you do not have permission to register customers.'); continue; }
      else { p.isNewCustomer = true; p.customerRef = s.clientId ? pad(s.clientId) : 'New customer'; if (s.clientId) p.warnings.push(`Client number ${s.clientId} is not in the portal; they are added with that number.`); p.matchedName = titleCase(s.name); if (s.ippis) seenIppis.add(s.ippis); if (s.clientId) seenNo.add(s.clientId); p._work = { newCustomer: { name: titleCase(s.name), ippis: s.ippis, ministry: s.ministry, clientNo: s.clientId ?? undefined }, balance: s.balance, tenor: p.tenor }; p.action = 'opening-balance'; continue; }
    }
    p.matchedName = cust.fullName; p.customerRef = cust.customerId;
    if (seen.has(String(cust._id))) { err('This customer appears twice in the sheet.'); continue; }
    seen.add(String(cust._id));
    const ex = openBy.get(String(cust._id));
    if (ex) { err(`${cust.fullName} already has a ${ex.status} loan (${ex.loanId}). An opening balance is only for customers with no open loan.`); continue; }
    p._work = { customer: cust, balance: s.balance, tenor: p.tenor }; p.action = 'opening-balance';
  }
  const count = (f: (r: BalanceRow) => boolean) => rows.filter(f).length;
  return { rows, asAt, counts: { balances: count((r) => r.action === 'opening-balance'), newCustomers: count((r) => !!r.isNewCustomer && r.action === 'opening-balance'), skipped: count((r) => r.action === 'skipped'), errors: count((r) => r.action === 'error'), total: rows.reduce((a, r) => a + (r.action === 'opening-balance' ? r.balance ?? 0 : 0), 0) }, needsApproval: !perms.canApprove, productId: String(product._id) };
}
export const publicBalancePlan = (p: Awaited<ReturnType<typeof planBalances>>) => ({ ...p, rows: p.rows.map(({ _work, ...r }) => r) });

export async function applyBalances(buf: Buffer, filename: string, actor: Actor, perms: UploadPerms, asAtParam?: string) {
  const plan = await planBalances(buf, perms, asAtParam);
  const results: any[] = [];
  for (const r of plan.rows) {
    const base = { row: r.row, name: r.matchedName ?? r.name, clientId: r.customerRef ?? r.clientId ?? '', ippis: r.ippis, kind: 'OPENING BALANCE' };
    if (r.action === 'error') { results.push({ ...base, status: 'skipped', messages: r.errors }); continue; }
    if (r.action === 'skipped' || !r._work) { results.push({ ...base, status: 'unchanged', messages: r.warnings }); continue; }
    const w = r._work; const messages = [...r.warnings];
    try {
      let customer = w.customer;
      if (w.newCustomer) {
        const t = w.newCustomer.name.split(' ');
        if (w.newCustomer.clientNo) await ensureSequenceAtLeast('customer', w.newCustomer.clientNo);
        customer = await Customer.create({ customerId: w.newCustomer.clientNo ? pad(w.newCustomer.clientNo) : await nextCustomerId(), firstName: t[0], middleName: t.length > 2 ? t.slice(1, -1).join(' ') : undefined, lastName: t.length > 1 ? t[t.length - 1] : t[0], fullName: w.newCustomer.name, status: 'active',
          employment: { ...(w.newCustomer.ippis ? { ippisNumber: w.newCustomer.ippis } : {}), ...(w.newCustomer.ministry ? { ministry: w.newCustomer.ministry } : {}), sector: w.newCustomer.ippis ? 'government' : 'non_government' }, emergencyContact: {}, createdBy: actor.id, updatedBy: actor.id } as any);
        await auditAs(actor, { action: AUDIT.CUSTOMER_CREATED, entity: 'Customer', entityId: String(customer._id), entityLabel: customer.customerId, after: serializeCustomer(customer) });
        messages.unshift(`New customer registered as ${customer.customerId}; complete their profile.`);
      }
      const draft = await buildDraft({ productId: plan.productId, amount: w.balance, duration: { value: w.tenor, unit: 'months' }, frequency: 'monthly', numberOfInstallments: w.tenor, startDate: plan.asAt }, { skipLimits: true, allowBackdated: true, rates: { interestRate: 0, applicationFeeRate: 0, rateBasis: 'per_month' } });
      const loan = await createLoanRecord(draft, { customerId: customer._id as Types.ObjectId, status: 'pending', actorId: actor.id, notes: `Opening balance as at ${plan.asAt.toISOString().slice(0, 10)} (${filename})`, extra: { loanType: 'opening', openingBalance: true } });
      await auditAs(actor, { action: AUDIT.LOAN_CREATED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, after: { customer: customer.customerId, openingBalance: w.balance, asAt: plan.asAt.toISOString().slice(0, 10), viaUpload: filename } });
      let status = 'pending'; if (perms.canApprove) { await approveLoan(String(loan._id), actor, { system: true }); status = 'active'; }
      results.push({ ...base, name: customer.fullName, clientId: customer.customerId, status, loan: String(loan._id), loanRef: loan.loanId, messages });
    } catch (e: any) { results.push({ ...base, status: 'skipped', messages: [...messages, e?.message ?? 'Could not record this balance.'] }); }
  }
  const created = results.filter((x) => x.loan).length; const skipped = results.filter((x) => x.status === 'skipped').length;
  const rec = await MonthlyUpload.create({ filename, uploadedBy: actor.id, uploadedByName: actor.name, needsApproval: !perms.canApprove, total: results.length, created, updated: 0, skipped, rows: results });
  await auditAs(actor, { action: AUDIT.MONTHLY_UPLOAD, entity: 'MonthlyUpload', entityId: String(rec._id), entityLabel: filename, after: { openingBalances: created, skipped, asAt: plan.asAt.toISOString().slice(0, 10), pendingApproval: !perms.canApprove } });
  return { id: String(rec._id), filename, asAt: plan.asAt, total: results.length, created, updated: 0, skipped, unchanged: results.filter((x) => x.status === 'unchanged').length, needsApproval: !perms.canApprove, rows: results };
}
