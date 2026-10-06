import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { Customer } from '../models/Customer.js';
import { Loan } from '../models/Loan.js';
import { LoanProduct } from '../models/LoanProduct.js';
import { TopUp } from '../models/TopUp.js';
import { MonthlyUpload } from '../models/MonthlyUpload.js';
import { AppError } from '../utils/AppError.js';
import { AUDIT } from '../config/auditActions.js';
import { CUSTOMER_STATUSES } from '../config/customerOptions.js';
import { LIVE_LOAN_STATUSES } from '../config/loanOptions.js';
import { fromKobo, toKobo } from '../utils/money.js';
import { addMonths } from '../utils/dates.js';
import { auditAs } from './AuditService.js';
import { buildDraft, createLoanRecord, approveLoan } from './loan.service.js';
import { nextTopUpId } from './topup.service.js';
import { xlFooter, xlHeaderRow, xlStyleBody, xlTitleBlock, xlPrint, XL_DATE } from './exportStyle.js';
import type { Actor } from '../types/index.js';

/**
 * Monthly "loans taken" sheet (Clients ID, Clients Name, IPPIS NO, MINISTRY, Tenor, Payment Date, Balance B/Fwd, Bank payment, ..., EMI,
 * Start Date, End date, Status). Each row is matched to a customer by client number AND IPPIS number, priced like the book
 * (gross = bank / (1 - deduction), principal = B/Fwd + gross) and turned into a loan:
 *  - the EMI written in the sheet is respected: total = EMI x tenor, interest = total - principal;
 *  - NEW / RENEWAL rows need a customer with no open loan; TOP UP rows liquidate the customer's running loan (B/Fwd is what the new loan carries);
 *  - uploaders who cannot approve loans create PENDING loans, which the CEO can edit and then approve; the CEO's own uploads go live straight away.
 */
export type RowStatus = 'create' | 'error';
export interface PlannedRow {
  row: number; name: string; clientId: string | null; ippis: string; type: 'NEW' | 'TOP UP' | 'RENEWAL' | null; status: RowStatus
  customerId?: string; customerRef?: string; matchedName?: string; topUpOfRef?: string
  tenor?: number; bank?: number; carried?: number; gross?: number; principal?: number; interest?: number; total?: number; emi?: number; paymentDate?: Date; firstPayment?: Date | null
  errors: string[]; warnings: string[]
  _draft?: { customer: any; oldLoan?: any; input: any; extra: any }
}
export interface MonthlyPlan { rows: PlannedRow[]; willCreate: number; errors: number; needsApproval: boolean; product: string }

const pad = (n: number) => `PTC-${String(n).padStart(6, '0')}`;
const clean = (v: unknown) => (v === null || v === undefined ? '' : String(typeof v === 'object' && v && 'result' in (v as any) ? (v as any).result : typeof v === 'object' && v && 'text' in (v as any) ? (v as any).text : v).replace(/\s+/g, ' ').trim());
const num = (v: unknown) => { if (v && typeof v === 'object' && 'result' in (v as any)) v = (v as any).result; const s = clean(v).replace(/[,₦\s]/g, ''); return s === '' || isNaN(+s) ? null : +s; };
function date(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(+v)) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = clean(v); if (!s) return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); if (m) return new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
}

interface SheetRow { row: number; clientId: number | null; name: string; ippis: string; ministry: string; tenor: number | null; paymentDate: Date | null; bf: number | null; bank: number | null; emi: number | null; gross: number | null; principal: number | null; interest: number | null; loan: number | null; firstPayment: Date | null; status: string; product: string }

async function readSheet(buf: Buffer): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw AppError.badRequest('This is not a valid Excel (.xlsx) file', 'UPLOAD_BAD_FILE'); }
  const ws = wb.worksheets[0]; if (!ws) throw AppError.badRequest('The workbook has no sheets', 'UPLOAD_BAD_FILE');
  const head = new Map<string, number>(); ws.getRow(1).eachCell((c, i) => head.set(clean(c.value).toLowerCase(), i));
  const find = (...needles: string[]) => { for (const [k, i] of head) if (needles.some((n) => k === n || k.startsWith(n))) return i; return undefined; };
  const c = { id: find('clients id', 'client id'), name: find('clients name', 'client name'), ippis: find('ippis'), min: find('ministry'), tenor: find('tenor'), pay: find('payment date'), bf: find('balance b/fwd', 'balance'), bank: find('bank payment'), emi: find('emi'), gross: find('gross payment'), principal: find('principal'), interest: find('interest'), loan: find('gross loan'), start: find('start date'), status: find('status'), product: find('product') };
  const missing = (['name', 'tenor', 'bank'] as const).filter((k) => !c[k]);
  if (!c.id && !c.ippis) missing.push('id' as any);
  if (missing.length) throw AppError.badRequest(`The sheet is missing these columns: ${missing.map((m) => ({ name: 'Clients Name', tenor: 'Tenor', bank: 'Bank payment', id: 'Clients ID or IPPIS NO' })[m as string]).join(', ')}. Download the template to see the format.`, 'UPLOAD_BAD_FILE');
  const out: SheetRow[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const g = (i?: number) => (i ? r.getCell(i).value : null);
    const name = clean(g(c.name)); const idRaw = clean(g(c.id));
    if (!name && !idRaw && !clean(g(c.ippis))) return;
    out.push({ row: n, clientId: /^\d+$/.test(idRaw) ? +idRaw : null, name, ippis: clean(g(c.ippis)).toUpperCase(), ministry: clean(g(c.min)), tenor: num(g(c.tenor)), paymentDate: date(g(c.pay)), bf: num(g(c.bf)), bank: num(g(c.bank)), emi: num(g(c.emi)), gross: num(g(c.gross)), principal: num(g(c.principal)), interest: num(g(c.interest)), loan: num(g(c.loan)), firstPayment: date(g(c.start)), status: clean(g(c.status)).toUpperCase().replace(/[-_]/g, ' '), product: clean(g(c.product)) });
  });
  if (!out.length) throw AppError.badRequest('The sheet has no rows', 'UPLOAD_EMPTY');
  return out;
}

export async function planMonthlyUpload(buf: Buffer, canApprove: boolean): Promise<MonthlyPlan> {
  const sheet = await readSheet(buf);
  const products = await LoanProduct.find({ isActive: true, allowedFrequencies: 'monthly' }).sort({ createdAt: 1 });
  if (!products.length) throw AppError.badRequest('Create an active monthly loan product first (Loan products).', 'NO_PRODUCT');

  const ids = sheet.map((r) => r.clientId).filter((x): x is number => !!x);
  const ippis = sheet.map((r) => r.ippis).filter(Boolean);
  const customers = await Customer.find({ isArchived: false, $or: [{ customerId: { $in: ids.map(pad) } }, { legacyId: { $in: ids.map(String) } }, { 'employment.ippisNumber': { $in: ippis } }] });
  const byRef = new Map(customers.map((c) => [c.customerId, c])); const byLegacy = new Map(customers.filter((c) => c.legacyId).map((c) => [String(c.legacyId), c]));
  const byIppis = new Map(customers.filter((c) => c.employment?.ippisNumber).map((c) => [String(c.employment!.ippisNumber).toUpperCase(), c]));
  const open = await Loan.find({ customer: { $in: customers.map((c) => c._id) }, status: { $in: ['pending', 'approved', ...LIVE_LOAN_STATUSES] } }).select('loanId status customer loanType');
  const openBy = new Map<string, any[]>(); for (const l of open) openBy.set(String(l.customer), [...(openBy.get(String(l.customer)) ?? []), l]);
  const doneBefore = new Set((await Loan.find({ customer: { $in: customers.map((c) => c._id) }, status: 'completed' }).select('customer')).map((l) => String(l.customer)));

  const seen = new Set<string>(); const rows: PlannedRow[] = [];
  for (const s of sheet) {
    const p: PlannedRow = { row: s.row, name: s.name, clientId: s.clientId ? String(s.clientId) : null, ippis: s.ippis, type: null, status: 'error', errors: [], warnings: [] };
    rows.push(p); const err = (m: string) => p.errors.push(m);
    // customer: by client number and by IPPIS; both must point to the same person
    const a = s.clientId ? byRef.get(pad(s.clientId)) ?? byLegacy.get(String(s.clientId)) : undefined; const b = s.ippis ? byIppis.get(s.ippis) : undefined;
    if (a && b && String(a._id) !== String(b._id)) { err(`Client ${s.clientId} is ${a.fullName}, but IPPIS ${s.ippis} belongs to ${b.fullName}. Check the row.`); continue; }
    const cust = a ?? b;
    if (!cust) { err(`No customer with ${s.clientId ? `client number ${s.clientId}` : ''}${s.clientId && s.ippis ? ' or ' : ''}${s.ippis ? `IPPIS ${s.ippis}` : ''} in the portal. Import or register the customer first.`); continue; }
    p.customerId = String(cust._id); p.customerRef = cust.customerId; p.matchedName = cust.fullName;
    if (s.name && cust.fullName.toLowerCase().replace(/\s+/g, '') !== s.name.toLowerCase().replace(/\s+/g, '')) p.warnings.push(`The sheet says "${s.name}"; the portal has "${cust.fullName}". Matched by ${a ? 'client number' : 'IPPIS'}.`);
    if (!s.clientId && b) p.warnings.push('Matched by IPPIS only (no client number in the row).');
    if (seen.has(String(cust._id))) { err('This customer appears twice in the sheet. Only one loan per customer can be uploaded.'); continue; }
    seen.add(String(cust._id));
    if (!CUSTOMER_STATUSES.find((x) => x.value === cust.status)?.canBorrow) { err(`${cust.fullName} is ${cust.status} and cannot be given a loan.`); continue; }
    // numbers
    if (!s.tenor || s.tenor < 1 || !Number.isInteger(s.tenor)) err('Tenor must be a whole number of months.');
    if (!s.bank || s.bank <= 0) err('Bank payment is missing.');
    if (!s.paymentDate) err('Payment Date is missing or not a date.');
    if (s.bf !== null && s.bf < 0) err('Balance B/Fwd cannot be negative.');
    if (p.errors.length) continue;
    // type
    const type = s.status === 'TOP UP' || s.status === 'TOPUP' ? 'TOP UP' : s.status === 'NEW' || s.status === '' ? 'NEW' : s.status === 'RENEWAL' ? 'RENEWAL' : null;
    if (!type) { err(`Status "${s.status}" is not understood. Use NEW, TOP UP or RENEWAL.`); continue; }
    p.type = type;
    const theirs = openBy.get(String(cust._id)) ?? []; const live = theirs.filter((l) => (LIVE_LOAN_STATUSES as readonly string[]).includes(l.status));
    let oldLoan: any;
    if (type === 'TOP UP') {
      if (theirs.some((l) => ['pending', 'approved'].includes(l.status))) { err(`${cust.fullName} already has a loan waiting for approval (${theirs.find((l) => ['pending', 'approved'].includes(l.status)).loanId}).`); continue; }
      oldLoan = live[0]; if (!oldLoan) { err(`${cust.fullName} has no running loan to top up. Use NEW (or RENEWAL) for a fresh loan.`); continue; }
      p.topUpOfRef = oldLoan.loanId;
      if (!s.bf) p.warnings.push('TOP UP row without a Balance B/Fwd: the new loan carries nothing from the old one.');
    } else if (theirs.length) { err(`${cust.fullName} already has a ${theirs[0].status} loan (${theirs[0].loanId}). Mark this row TOP UP to liquidate it.`); continue; }
    else if (type === 'NEW' && doneBefore.has(String(cust._id))) p.warnings.push('This customer has repaid loans before; saved as a renewal.');
    // price
    const product = (s.product && products.find((x) => x.code.toLowerCase() === s.product.toLowerCase() || x.name.toLowerCase() === s.product.toLowerCase())) || products[0]!;
    const ded = (product.bankDeductionRate ?? 0) / 100;
    const bfK = toKobo(s.bf ?? 0); const grossK = ded > 0 ? Math.round(toKobo(s.bank!) / (1 - ded)) : toKobo(s.bank!); const principalK = bfK + grossK;
    let rates: { interestRate: number; bankDeductionRate: number; rateBasis: string } | undefined;
    if (s.emi && s.emi > 0) { // the book's own EMI decides the interest
      const totalK = Math.round(s.emi * 100 * s.tenor!); const interestK = totalK - principalK;
      if (interestK < 0) { err(`EMI × tenor (${fromKobo(totalK).toLocaleString('en-NG')}) is less than the principal (${fromKobo(principalK).toLocaleString('en-NG')}). Check the EMI, tenor and amounts.`); continue; }
      rates = { interestRate: Math.round(((interestK / principalK / s.tenor!) * 100) * 1e4) / 1e4, bankDeductionRate: product.bankDeductionRate ?? 0, rateBasis: 'per_month' };
    } else { // blank EMI: the sheet's own formulas (Interest = Principal x Rate x Tenor, EMI = Gross Loan / Tenor) fill the gaps
      rates = { interestRate: product.interestRate, bankDeductionRate: product.bankDeductionRate ?? 0, rateBasis: 'per_month' };
      p.warnings.push(`EMI left blank: calculated with the sheet formulas (interest = principal × ${product.interestRate}% × ${s.tenor} months, EMI = total ÷ tenor).`);
    }
    const firstPayment = s.firstPayment && s.firstPayment >= s.paymentDate! ? s.firstPayment : undefined;
    if (s.firstPayment && !firstPayment) p.warnings.push('Start Date is before the Payment Date; the standard repayment cycle is used instead.');
    try {
      const draft = await buildDraft({ productId: String(product._id), amount: s.bank!, duration: { value: s.tenor!, unit: 'months' }, frequency: 'monthly', numberOfInstallments: s.tenor!, startDate: s.paymentDate!, firstPaymentDate: firstPayment },
        { carriedBalance: s.bf ?? 0, skipLimits: true, allowBackdated: true, ...(rates ? { rates } : {}) });
      const t = draft.terms; Object.assign(p, { tenor: t.numberOfInstallments, bank: t.amount, carried: t.carriedBalance, gross: t.grossAmount, principal: t.principal, interest: t.interestAmount, total: t.totalRepayment, emi: t.installmentAmount, paymentDate: t.startDate, firstPayment: t.firstDueDate });
      if (s.emi && Math.abs(t.installmentAmount - s.emi) > 1) p.warnings.push(`The portal's EMI (${t.installmentAmount.toLocaleString('en-NG')}) differs from the sheet (${s.emi.toLocaleString('en-NG')}).`);
      const diff = (label: string, theirs: number | null, ours: number) => { if (theirs !== null && Math.abs(theirs - ours) > 1) p.warnings.push(`${label} in the sheet (${theirs.toLocaleString('en-NG')}) differs from the calculated ${ours.toLocaleString('en-NG')}; the calculated figure is used.`); };
      diff('Gross Payment', s.gross, t.grossAmount); diff('Principal', s.principal, t.principal); diff('Interest', s.interest, t.interestAmount); diff('Gross Loan', s.loan, t.totalRepayment);
      p._draft = { customer: cust, oldLoan, input: { draft }, extra: { loanType: type === 'TOP UP' ? 'topup' : type === 'RENEWAL' || doneBefore.has(String(cust._id)) ? 'renewal' : 'new' } };
      p.status = 'create';
    } catch (e: any) { err(e?.message ?? 'Could not price this row.'); }
  }
  return { rows, willCreate: rows.filter((r) => r.status === 'create').length, errors: rows.filter((r) => r.status === 'error').length, needsApproval: !canApprove, product: products[0]!.name };
}

export const publicPlan = (p: MonthlyPlan) => ({ ...p, rows: p.rows.map(({ _draft, ...r }) => r) });

export async function applyMonthlyUpload(buf: Buffer, filename: string, actor: Actor, canApprove: boolean) {
  const plan = await planMonthlyUpload(buf, canApprove);
  const results: any[] = [];
  for (const r of plan.rows) {
    const base = { row: r.row, name: r.matchedName ?? r.name, clientId: r.customerRef ?? r.clientId ?? '', ippis: r.ippis, kind: r.type ?? '' };
    if (r.status !== 'create' || !r._draft) { results.push({ ...base, status: 'skipped', messages: r.errors }); continue; }
    try {
      const { customer, oldLoan, input, extra } = r._draft; const draft = input.draft;
      let topUpId: Types.ObjectId | undefined;
      if (oldLoan) {
        const t = await TopUp.create({ topUpId: await nextTopUpId(), customer: customer._id, loan: oldLoan._id, requestedAmount: draft.terms.amount, duration: draft.duration, frequency: 'monthly', interestRate: draft.rates.interestRate, startDate: draft.terms.startDate,
          calculation: { source: 'monthly upload', carriedBalance: draft.terms.carriedBalance, terms: draft.terms, existingLoan: oldLoan.loanId }, notes: `Monthly upload ${filename}`, requestedBy: actor.id } as any);
        topUpId = t._id;
      }
      const loan = await createLoanRecord(draft, { customerId: customer._id, status: 'pending', actorId: actor.id, notes: `Monthly upload (${filename})`, extra: { ...extra, ...(oldLoan ? { topUpOf: oldLoan._id, topUp: topUpId } : {}) } });
      await auditAs(actor, { action: AUDIT.LOAN_CREATED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, after: { customer: customer.customerId, viaMonthlyUpload: filename, type: r.type, totalRepayment: draft.terms.totalRepayment, installments: draft.terms.numberOfInstallments } });
      let status = 'pending';
      if (canApprove) { await approveLoan(String(loan._id), actor, { system: true }); status = 'active'; }
      results.push({ ...base, status, loan: String(loan._id), loanRef: loan.loanId, messages: r.warnings });
    } catch (e: any) { results.push({ ...base, status: 'skipped', messages: [e?.message ?? 'Could not create the loan.'] }); }
  }
  const created = results.filter((r) => r.loan).length;
  const rec = await MonthlyUpload.create({ filename, uploadedBy: actor.id, uploadedByName: actor.name, needsApproval: !canApprove, total: results.length, created, skipped: results.length - created, rows: results });
  await auditAs(actor, { action: AUDIT.MONTHLY_UPLOAD, entity: 'MonthlyUpload', entityId: String(rec._id), entityLabel: filename, after: { total: results.length, created, skipped: results.length - created, pendingApproval: !canApprove } });
  return { id: String(rec._id), filename, total: results.length, created, skipped: results.length - created, needsApproval: !canApprove, rows: results };
}

export async function listMonthlyUploads() {
  return (await MonthlyUpload.find().sort({ createdAt: -1 }).limit(30).select('-rows').lean()).map((u: any) => ({ id: String(u._id), filename: u.filename, uploadedBy: u.uploadedByName, createdAt: u.createdAt, total: u.total, created: u.created, skipped: u.skipped, needsApproval: !!u.needsApproval }));
}
export async function getMonthlyUpload(id: string) {
  const u: any = Types.ObjectId.isValid(id) ? await MonthlyUpload.findById(id).lean() : null;
  if (!u) throw AppError.notFound('Upload not found', 'UPLOAD_NOT_FOUND');
  return { ...u, id: String(u._id), _id: undefined };
}

/** The sheet people fill in: Protech's own columns, with the book's formulas ready for the gross payment, principal, interest, loan and EMI. */
export async function monthlyTemplate(company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = company; const ws = wb.addWorksheet('Loans taken');
  const heads = ['S/N', 'Clients ID', 'Clients Name', 'IPPIS NO', 'MINISTRY', 'Tenor', 'Payment Date', 'Balance B/Fwd', 'Bank payment', 'Gross Payment (Column I/.96)', 'Principal (H+J)', 'Interest', 'Gross Loan (K+L)', 'EMI', 'Start Date', 'End date', 'Status'];
  xlTitleBlock(ws, company, 'Monthly upload: loans taken', 'Fill one row per customer. Status: NEW, TOP UP or RENEWAL. Delete the example rows.', heads.length);
  const h = ws.addRow(heads); xlHeaderRow(h, heads.length);
  const first = ws.rowCount + 1;
  const rows: unknown[][] = [[1, 551, 'EXAMPLE CLIENT (TOP UP)', 434590, 'OSGF', 12, new Date('2026-08-04T00:00:00Z'), 36012.38, 96000, null, null, null, null, null, new Date('2026-09-01T00:00:00Z'), new Date('2027-08-31T00:00:00Z'), 'TOP UP'], [2, 637, 'EXAMPLE CLIENT (NEW)', 480210, 'LABOUR', 12, new Date('2026-08-05T00:00:00Z'), null, 240000, null, null, null, null, null, new Date('2026-09-01T00:00:00Z'), new Date('2027-08-31T00:00:00Z'), 'NEW']];
  rows.forEach((r) => ws.addRow(r));
  for (let n = first; n < first + rows.length; n++) { // the book's formulas
    ws.getCell(`J${n}`).value = { formula: `ROUND(I${n}/0.96,2)` }; ws.getCell(`K${n}`).value = { formula: `ROUND(H${n}+J${n},2)` };
    ws.getCell(`L${n}`).value = { formula: `ROUND(K${n}*5%*F${n},2)` }; ws.getCell(`M${n}`).value = { formula: `ROUND(K${n}+L${n},2)` }; ws.getCell(`N${n}`).value = { formula: `ROUND(M${n}/F${n},2)` };
  }
  xlStyleBody(ws, first, first + rows.length - 1, ['number', 'number', 'text', 'text', 'text', 'number', 'date', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'date', 'date', 'text']);
  void XL_DATE; void addMonths;
  [6, 10, 30, 12, 18, 7, 14, 15, 15, 18, 16, 15, 16, 14, 14, 14, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  xlFooter(ws, 'The EMI in your sheet is respected: total loan = EMI x tenor. If EMI is left empty the product\'s interest rule is used. Clients are matched by Clients ID and IPPIS NO.', heads.length);
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: h.number }]; xlPrint(ws, { company, headerRow: h.number });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
