import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { Customer } from '../models/Customer.js';
import { Loan } from '../models/Loan.js';
import { LoanProduct } from '../models/LoanProduct.js';
import { TopUp } from '../models/TopUp.js';
import { MonthlyUpload } from '../models/MonthlyUpload.js';
import { AppError } from '../utils/AppError.js';
import { AUDIT } from '../config/auditActions.js';
import { CUSTOMER_STATUSES, MARITAL_STATUSES } from '../config/customerOptions.js';
import { LIVE_LOAN_STATUSES } from '../config/loanOptions.js';
import { fromKobo, toKobo } from '../utils/money.js';
import { normalizePhone } from '../utils/phone.js';
import { auditAs } from './AuditService.js';
import { buildDraft, createLoanRecord, approveLoan, updateLoan } from './loan.service.js';
import { updateCustomer, nextCustomerId, serialize as serializeCustomer } from './customer.service.js';
import { nextTopUpId } from './topup.service.js';
import { xlFooter, xlHeaderRow, xlStyleBody, xlTitleBlock, xlPrint } from './exportStyle.js';
import type { Actor } from '../types/index.js';

/**
 * The monthly sheet. It is the SAME layout as the customer register download, so the register can be edited in Excel and uploaded back.
 * Each row is matched to a customer by Clients ID and IPPIS NO, then:
 *  - customer details that differ from the portal (name, IPPIS, ministry, phone, address, NIN, BVN, date of birth, marital status, next of kin phone) are updated;
 *    blank cells never erase anything;
 *  - a row WITH a Loan ID refers to that customer's current loan: changed loan figures (tenor, bank payment, B/Fwd, dates, EMI) update it;
 *  - a row WITHOUT a Loan ID that has loan figures is a new loan: NEW / RENEWAL (no open loan) or TOP UP (liquidates the running loan);
 *  - the EMI written in the sheet decides the interest (total = EMI x tenor); a blank EMI is calculated with the sheet formulas.
 * Uploaders without loans.approve create PENDING loans for the CEO to approve; changing a running loan needs loans.editActive.
 */
export interface UploadPerms { canApprove: boolean; canEditLoans: boolean; canEditRunning: boolean; canUpdateCustomers: boolean; canCreateCustomers?: boolean }
export type RowAction = 'new-loan' | 'top-up' | 'update-loan' | 'update-customer' | 'new-customer' | 'unchanged' | 'error'
export interface PlannedRow {
  row: number; name: string; clientId: string | null; ippis: string; type: 'NEW' | 'TOP UP' | 'RENEWAL' | null; action: RowAction
  customerId?: string; customerRef?: string; matchedName?: string; topUpOfRef?: string; loanRef?: string
  tenor?: number; bank?: number; carried?: number; gross?: number; principal?: number; interest?: number; total?: number; emi?: number
  isNewCustomer?: boolean; customerChanges: string[]; loanChanges: string[]; errors: string[]; warnings: string[]
  _work?: { customer: any; newCustomer?: { name: string }; custInput?: Record<string, any>; draft?: any; oldLoan?: any; loan?: any; extra?: any; ratesForEdit?: any; firstPayment?: Date }
}
export interface MonthlyPlan { rows: PlannedRow[]; counts: { newLoans: number; loanUpdates: number; customerUpdates: number; newCustomers: number; unchanged: number; errors: number }; needsApproval: boolean; product: string }

const pad = (n: number) => `PTC-${String(n).padStart(6, '0')}`;
const clean = (v: unknown) => (v === null || v === undefined ? '' : String(typeof v === 'object' && v && 'result' in (v as any) ? (v as any).result ?? '' : typeof v === 'object' && v && 'text' in (v as any) ? (v as any).text : v).replace(/\s+/g, ' ').trim());
const num = (v: unknown) => { if (v && typeof v === 'object' && 'result' in (v as any)) v = (v as any).result; const s = clean(v).replace(/[,₦\s]/g, ''); return s === '' || isNaN(+s) ? null : +s; };
function date(v: unknown): Date | null {
  if (v && typeof v === 'object' && 'result' in (v as any)) v = (v as any).result;
  if (v instanceof Date && !isNaN(+v)) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = clean(v); if (!s) return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); if (m) return new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
}
const sameDay = (a?: Date | null, b?: Date | null) => !!a && !!b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Client numbers are accepted as 641 or PTC-000641. */
const clientNo = (raw: string) => { const m = /^(?:PTC[-\s]?)?0*(\d+)$/i.exec(raw.trim()); return m ? +m[1]! : null; };
const maritalOf = (s: string) => { const t = s.toLowerCase(); return MARITAL_STATUSES.find((m) => t.startsWith(m.value.slice(0, 4)))?.value; };
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-'/])([a-z])/g, (_m, a, b) => a + b.toUpperCase());

interface SheetRow {
  row: number; clientId: number | null; name: string; ippis: string; ministry: string; phone: string; address: string; nin: string; bvn: string; dob: Date | null; marital: string; nok: string; nokName: string; email: string; state: string; gender: string; custStatus: string; worker: string
  tenor: number | null; paymentDate: Date | null; bf: number | null; bank: number | null; emi: number | null; gross: number | null; principal: number | null; interest: number | null; loan: number | null
  firstPayment: Date | null; status: string; product: string; loanId: string
}

async function readSheet(buf: Buffer): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw AppError.badRequest('This is not a valid Excel (.xlsx) file', 'UPLOAD_BAD_FILE'); }
  const ws = wb.worksheets[0]; if (!ws) throw AppError.badRequest('The workbook has no sheets', 'UPLOAD_BAD_FILE');
  // the header row is the first row that contains a "Clients Name" cell (the register has a title banner above it)
  let headRow = 0; ws.eachRow((r, n) => { if (!headRow) r.eachCell((c) => { if (!headRow && clean(c.value).toLowerCase() === 'clients name') headRow = n; }); });
  if (!headRow) throw AppError.badRequest('Could not find the header row (a "Clients Name" column). Download the register or template to see the format.', 'UPLOAD_BAD_FILE');
  const head = new Map<string, number>(); ws.getRow(headRow).eachCell((c, i) => head.set(clean(c.value).toLowerCase(), i));
  const find = (...needles: string[]) => { for (const n of needles) { const exact = head.get(n); if (exact) return exact; } for (const [k, i] of head) if (needles.some((n) => k.startsWith(n))) return i; return undefined; };
  const c = { id: find('clients id', 'client id'), name: find('clients name', 'client name'), ippis: find('ippis'), min: find('ministry'), phone: find('phone no', 'phone'), addr: find('address'), nin: find('nin'), bvn: find('bvn'), dob: find('date of birth'), ms: find('marital status'), nok: find('next of kin phone'), nokName: find('next of kin name'), email: find('email'), state: find('state'), gender: find('gender'), custStatus: find('customer status'), worker: find('worker type'),
    tenor: find('tenor'), pay: find('payment date'), bf: find('balance b/fwd', 'balance'), bank: find('bank payment'), emi: find('emi'), gross: find('gross payment'), principal: find('principal'), interest: find('interest'), loan: find('gross loan'), start: find('start date'), status: find('status'), product: find('product'), loanId: find('loan id') };
  if (!c.id && !c.ippis) throw AppError.badRequest('The sheet needs a Clients ID or IPPIS NO column.', 'UPLOAD_BAD_FILE');
  const out: SheetRow[] = [];
  ws.eachRow((r, n) => {
    if (n <= headRow) return;
    const g = (i?: number) => (i ? r.getCell(i).value : null);
    const name = clean(g(c.name)); const idRaw = clean(g(c.id)); const ippis = clean(g(c.ippis)).toUpperCase();
    if (!name && !idRaw && !ippis) return;
    if (/^(total|generated)/i.test(name) || /^(total|generated)/i.test(clean(g(1)))) return; // totals and footer rows of the register
    if (name.length > 80 || (name && name.toLowerCase() === clean(g(c.ippis)).toLowerCase() && name.length > 20)) return; // a merged note row (e.g. the template's footer)
    out.push({ row: n, clientId: clientNo(idRaw), name, ippis, ministry: clean(g(c.min)), phone: clean(g(c.phone)), address: clean(g(c.addr)), nin: clean(g(c.nin)).replace(/\D/g, ''), bvn: clean(g(c.bvn)).replace(/\D/g, ''), dob: date(g(c.dob)), marital: clean(g(c.ms)), nok: clean(g(c.nok)), nokName: clean(g(c.nokName)), email: clean(g(c.email)).toLowerCase(), state: clean(g(c.state)), gender: clean(g(c.gender)).toLowerCase(), custStatus: clean(g(c.custStatus)).toLowerCase(), worker: clean(g(c.worker)).toLowerCase(),
      tenor: num(g(c.tenor)), paymentDate: date(g(c.pay)), bf: num(g(c.bf)), bank: num(g(c.bank)), emi: num(g(c.emi)), gross: num(g(c.gross)), principal: num(g(c.principal)), interest: num(g(c.interest)), loan: num(g(c.loan)),
      firstPayment: date(g(c.start)), status: clean(g(c.status)).toUpperCase().replace(/[-_]/g, ' '), product: clean(g(c.product)), loanId: clean(g(c.loanId)).toUpperCase() });
  });
  if (!out.length) throw AppError.badRequest('The sheet has no rows', 'UPLOAD_EMPTY');
  return out;
}

export async function planMonthlyUpload(buf: Buffer, perms: UploadPerms): Promise<MonthlyPlan> {
  const sheet = await readSheet(buf);
  const products = await LoanProduct.find({ isActive: true, allowedFrequencies: 'monthly' }).sort({ createdAt: 1 });
  const ids = sheet.map((r) => r.clientId).filter((x): x is number => !!x); const ippisList = sheet.map((r) => r.ippis).filter(Boolean);
  const customers = await Customer.find({ isArchived: false, $or: [{ customerId: { $in: ids.map(pad) } }, { legacyId: { $in: ids.map(String) } }, { 'employment.ippisNumber': { $in: ippisList } }] });
  const byRef = new Map(customers.map((c) => [c.customerId, c])); const byLegacy = new Map(customers.filter((c) => c.legacyId).map((c) => [String(c.legacyId), c]));
  const byIppis = new Map(customers.filter((c) => c.employment?.ippisNumber).map((c) => [String(c.employment!.ippisNumber).toUpperCase(), c]));
  const open = await Loan.find({ customer: { $in: customers.map((c) => c._id) }, status: { $in: ['pending', 'approved', ...LIVE_LOAN_STATUSES] } });
  const openBy = new Map<string, any[]>(); for (const l of open) openBy.set(String(l.customer), [...(openBy.get(String(l.customer)) ?? []), l]);
  const doneBefore = new Set((await Loan.find({ customer: { $in: customers.map((c) => c._id) }, status: 'completed' }).select('customer')).map((l) => String(l.customer)));
  // an IPPIS used by anybody (also customers not in this sheet), to catch a changed IPPIS that clashes
  const ippisOwner = async (ippis: string) => (byIppis.get(ippis) ?? (await Customer.findOne({ isArchived: false, 'employment.ippisNumber': ippis }))) as any;

  const seen = new Set<string>(); const rows: PlannedRow[] = [];
  for (const s of sheet) {
    const p: PlannedRow = { row: s.row, name: s.name, clientId: s.clientId ? String(s.clientId) : null, ippis: s.ippis, type: null, action: 'error', customerChanges: [], loanChanges: [], errors: [], warnings: [] };
    rows.push(p); const err = (m: string) => p.errors.push(m);
    // ---- who is this? client number and IPPIS must not point to two different people
    const a = s.clientId ? byRef.get(pad(s.clientId)) ?? byLegacy.get(String(s.clientId)) : undefined; const b = s.ippis ? byIppis.get(s.ippis) : undefined;
    if (a && b && String(a._id) !== String(b._id)) { err(`Client ${s.clientId} is ${a.fullName}, but IPPIS ${s.ippis} belongs to ${b.fullName}. Check the row.`); continue; }
    let cust: any = a ?? b; let isNew = false;
    if (!cust) {
      if (s.clientId) { err(`No customer with client number ${s.clientId}${s.ippis ? ` or IPPIS ${s.ippis}` : ''} in the portal. Leave Clients ID empty to add them as a new customer, or fix the number.`); continue; }
      if (!s.name) { err('The row has no client number, IPPIS or name.'); continue; }
      // no client number: an exact name match is the same person; otherwise this is a new customer
      const sameName = s.ippis ? [] : await Customer.find({ isArchived: false, fullName: new RegExp(`^${titleCase(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}$`, 'i') });
      if (sameName.length > 1) { err(`More than one customer is called ${titleCase(s.name)}. Put the Clients ID in the row.`); continue; }
      if (sameName.length === 1) {
        cust = sameName[0]; p.warnings.push('Matched by name only (no client number or IPPIS in the row).');
        const mine = await Loan.find({ customer: cust._id, status: { $in: ['pending', 'approved', 'completed', ...LIVE_LOAN_STATUSES] } }); // not loaded with the rest: fetch their loans now
        openBy.set(String(cust._id), mine.filter((l) => l.status !== 'completed')); for (const l of mine) if (l.status === 'completed') doneBefore.add(String(cust._id));
      }
      else if (!perms.canCreateCustomers) { err('This customer is not in the portal and you do not have permission to register customers.'); continue; }
      else { isNew = true; cust = { _id: new Types.ObjectId(), fullName: titleCase(s.name), status: 'active', employment: {}, emergencyContact: {}, customerId: undefined }; p.isNewCustomer = true; }
    }
    p.customerId = String(cust._id); p.customerRef = isNew ? 'New customer' : cust.customerId; p.matchedName = cust.fullName;
    if (!isNew && !a && s.clientId) p.warnings.push(`Client number ${s.clientId} was not found; matched by IPPIS.`);
    if (seen.has(String(cust._id))) { err('This customer appears twice in the sheet. Only one row per customer is allowed.'); continue; }
    seen.add(String(cust._id));

    // ---- customer details that changed (blank cells never erase anything)
    const custInput: Record<string, any> = {}; const emp: Record<string, any> = {}; const ec: Record<string, any> = {};
    if (s.name && norm(s.name) !== norm(cust.fullName)) {
      const t = titleCase(s.name).split(' '); custInput.firstName = t[0]; custInput.lastName = t.length > 1 ? t[t.length - 1] : t[0]; custInput.middleName = t.length > 2 ? t.slice(1, -1).join(' ') : ''; p.customerChanges.push(`Name: ${cust.fullName} → ${titleCase(s.name)}`);
    }
    if (s.ippis && s.ippis !== String(cust.employment?.ippisNumber ?? '').toUpperCase()) {
      const owner = await ippisOwner(s.ippis);
      if (owner && String(owner._id) !== String(cust._id)) { err(`IPPIS ${s.ippis} already belongs to ${owner.fullName}.`); continue; }
      emp.ippisNumber = s.ippis; if (!cust.employment?.sector || cust.employment.sector !== 'government') emp.sector = 'government'; p.customerChanges.push(`IPPIS: ${cust.employment?.ippisNumber ?? '—'} → ${s.ippis}`);
    }
    if (s.ministry && s.ministry.toUpperCase() !== String(cust.employment?.ministry ?? '').toUpperCase()) { emp.ministry = s.ministry.toUpperCase(); p.customerChanges.push(`Ministry: ${cust.employment?.ministry ?? '—'} → ${s.ministry.toUpperCase()}`); }
    const phone = s.phone ? normalizePhone(s.phone) : null; if (s.phone && !phone) p.warnings.push(`Phone "${s.phone}" is not a valid Nigerian number; ignored.`);
    if (phone && phone !== cust.phone) { custInput.phone = phone; p.customerChanges.push(`Phone: ${cust.phone ?? '—'} → ${phone}`); }
    if (s.address && s.address !== cust.address) { custInput.address = s.address; p.customerChanges.push('Address'); }
    if (s.nin) { if (!/^\d{11}$/.test(s.nin)) p.warnings.push('NIN is not 11 digits; ignored.'); else if (s.nin !== cust.nin) { custInput.nin = s.nin; p.customerChanges.push('NIN'); } }
    if (s.bvn) { if (!/^\d{11}$/.test(s.bvn)) p.warnings.push('BVN is not 11 digits; ignored.'); else if (s.bvn !== cust.bvn) { custInput.bvn = s.bvn; p.customerChanges.push('BVN'); } }
    if (s.dob && !sameDay(s.dob, cust.dateOfBirth ?? null)) { custInput.dateOfBirth = s.dob; p.customerChanges.push('Date of birth'); }
    const ms = s.marital ? maritalOf(s.marital) : undefined; if (s.marital && !ms) p.warnings.push(`Marital status "${s.marital}" not understood; ignored.`);
    if (ms && ms !== cust.maritalStatus) { custInput.maritalStatus = ms; p.customerChanges.push('Marital status'); }
    const nok = s.nok ? normalizePhone(s.nok) : null; if (s.nok && !nok) p.warnings.push('Next of kin phone is not valid; ignored.');
    if (nok && nok !== cust.emergencyContact?.phone) { ec.phone = nok; p.customerChanges.push('Next of kin phone'); }
    if (s.email) { if (!/^\S+@\S+\.\S+$/.test(s.email)) p.warnings.push('Email is not valid; ignored.'); else if (s.email !== cust.email) { custInput.email = s.email; p.customerChanges.push('Email'); } }
    if (s.state && s.state !== cust.state) { custInput.state = s.state; p.customerChanges.push('State'); }
    if (s.gender) { const g = s.gender.startsWith('m') ? 'male' : s.gender.startsWith('f') ? 'female' : null; if (!g) p.warnings.push(`Gender "${s.gender}" not understood; ignored.`); else if (g !== cust.gender) { custInput.gender = g; p.customerChanges.push('Gender'); } }
    if (s.nokName && s.nokName !== cust.emergencyContact?.name) { ec.name = s.nokName; p.customerChanges.push('Next of kin name'); }
    if (s.worker) {
      const sector = s.worker.startsWith('gov') ? 'government' : s.worker.startsWith('non') ? 'non_government' : null;
      if (!sector) p.warnings.push(`Worker type "${s.worker}" not understood; ignored.`);
      else if (sector !== (cust.employment?.sector ?? (cust.employment?.ippisNumber ? 'government' : undefined))) {
        if (sector === 'government' && !s.ippis && !cust.employment?.ippisNumber) p.warnings.push('Worker type Government needs an IPPIS number; ignored.');
        else { emp.sector = sector; p.customerChanges.push(`Worker type: ${sector === 'government' ? 'Government' : 'Non-government'}`); }
      }
    }
    if (s.custStatus) { const st = CUSTOMER_STATUSES.find((x) => x.value === s.custStatus || x.label.toLowerCase() === s.custStatus); if (!st) p.warnings.push(`Customer status "${s.custStatus}" not understood; ignored.`); else if (st.value !== cust.status) { custInput.status = st.value; p.customerChanges.push(`Status: ${cust.status} → ${st.value}`); } }
    if (Object.keys(emp).length) custInput.employment = emp; if (Object.keys(ec).length) custInput.emergencyContact = ec;
    if (isNew) p.customerChanges = []; // everything is new: the action label says so
    else if (p.customerChanges.length && !perms.canUpdateCustomers) { p.warnings.push('Customer detail changes were ignored: you need the permission to update customers.'); p.customerChanges = []; for (const k of Object.keys(custInput)) delete custInput[k]; }

    // ---- loan part
    const theirs = openBy.get(String(cust._id)) ?? []; const live = theirs.filter((l) => (LIVE_LOAN_STATUSES as readonly string[]).includes(l.status));
    const hasLoanData = !!(s.bank && s.bank > 0 && s.tenor);
    const work: NonNullable<PlannedRow['_work']> = { customer: cust, ...(isNew ? { newCustomer: { name: titleCase(s.name) } } : {}), ...(Object.keys(custInput).length ? { custInput } : {}) };
    p._work = work;
    const finish = (action: RowAction) => { p.action = action; };
    if (!hasLoanData) { // customer-only row
      if (s.loanId) p.loanRef = s.loanId;
      finish(isNew ? 'new-customer' : p.customerChanges.length ? 'update-customer' : 'unchanged'); continue;
    }
    if (!CUSTOMER_STATUSES.find((x) => x.value === cust.status)?.canBorrow && !s.loanId) { err(`${cust.fullName} is ${cust.status} and cannot be given a loan.`); continue; }
    if (!Number.isInteger(s.tenor!) || s.tenor! < 1) { err('Tenor must be a whole number of months.'); continue; }
    if (!s.paymentDate) { err('Payment Date is missing or not a date.'); continue; }
    if (s.bf !== null && s.bf < 0) { err('Balance B/Fwd cannot be negative.'); continue; }
    if (!products.length) { err('Create an active monthly loan product first (Loan products).'); continue; }
    const product = (s.product && products.find((x) => x.code.toLowerCase() === s.product.toLowerCase() || x.name.toLowerCase() === s.product.toLowerCase())) || products[0]!;
    const ded = (product.bankDeductionRate ?? 0) / 100;
    const bfK = toKobo(s.bf ?? 0); const grossK = ded > 0 ? Math.round(toKobo(s.bank!) / (1 - ded)) : toKobo(s.bank!); const principalK = bfK + grossK;
    const firstPayment = s.firstPayment && s.firstPayment >= s.paymentDate ? s.firstPayment : undefined;
    const draftWith = (rates: { interestRate: number; bankDeductionRate: number; rateBasis: string }) => buildDraft({ productId: String(product._id), amount: s.bank!, duration: { value: s.tenor!, unit: 'months' }, frequency: 'monthly', numberOfInstallments: s.tenor!, startDate: s.paymentDate!, firstPaymentDate: firstPayment }, { carriedBalance: s.bf ?? 0, skipLimits: true, allowBackdated: true, rates });
    // Which interest rule produced the sheet's EMI? Prefer the loan's / product's own rule when it reproduces the EMI, otherwise the monthly rate the EMI implies.
    type Rates = { interestRate: number; bankDeductionRate: number; rateBasis: string };
    const pickRates = async (candidates: Rates[], emi: number | null) => {
      const own = candidates[0]!;
      if (!emi) return { rates: own, how: 'own' as const };
      const totalK = Math.round(emi * 100 * s.tenor!); const interestK = totalK - principalK;
      if (interestK < 0) throw new Error(`EMI × tenor (${fromKobo(totalK).toLocaleString('en-NG')}) is less than the principal (${fromKobo(principalK).toLocaleString('en-NG')}). Check the EMI, tenor and amounts.`);
      for (const cand of candidates) { // a rule that reproduces the sheet's EMI exactly (within a naira) beats an implied rate
        const d = await draftWith(cand).catch(() => null);
        if (d && Math.abs(d.terms.totalRepayment - totalK / 100) <= 1) return { rates: cand, how: 'own' as const };
      }
      return { rates: { interestRate: interestK / principalK / s.tenor! * 100, bankDeductionRate: product.bankDeductionRate ?? 0, rateBasis: 'per_month' }, how: 'implied' as const };
    };
    const summarise = (draft: any) => { const t = draft.terms; Object.assign(p, { tenor: t.numberOfInstallments, bank: t.amount, carried: t.carriedBalance, gross: t.grossAmount, principal: t.principal, interest: t.interestAmount, total: t.totalRepayment, emi: t.installmentAmount }); return t; };
    const warnDiffs = (t: any) => {
      const diff = (label: string, theirsV: number | null, ours: number) => { if (theirsV !== null && Math.abs(theirsV - ours) > 1) p.warnings.push(`${label} in the sheet (${theirsV.toLocaleString('en-NG')}) differs from the calculated ${ours.toLocaleString('en-NG')}; the calculated figure is used.`); };
      if (s.emi && Math.abs(t.installmentAmount - s.emi) > 1) p.warnings.push(`The portal's EMI (${t.installmentAmount.toLocaleString('en-NG')}) differs from the sheet (${s.emi.toLocaleString('en-NG')}).`);
      diff('Gross Payment', s.gross, t.grossAmount); diff('Principal', s.principal, t.principal); diff('Interest', s.interest, t.interestAmount); diff('Gross Loan', s.loan, t.totalRepayment);
    };
    if (s.firstPayment && !firstPayment) p.warnings.push('Start Date is before the Payment Date; the standard repayment cycle is used instead.');

    if (s.loanId && isNew) { err('A new customer cannot have a Loan ID.'); continue; }
    if (s.loanId) { // ---- an existing loan: apply the changes
      const cur = theirs.find((l) => l.loanId === s.loanId);
      if (!cur) { err(`Loan ${s.loanId} is not ${cust.fullName}'s current loan${theirs[0] ? ` (it is ${theirs[0].loanId})` : ' (they have no open loan)'}. Clear the Loan ID cell to create a new loan.`); continue; }
      p.loanRef = cur.loanId; p.type = cur.loanType === 'topup' ? 'TOP UP' : cur.loanType === 'renewal' ? 'RENEWAL' : 'NEW';
      // what did the person change? compare the sheet's inputs with what is stored (no re-pricing, so untouched rows can never drift)
      const ch = p.loanChanges; const emiSame = !s.emi || Math.abs(s.emi - cur.installmentAmount) <= 0.02;
      if (s.tenor !== cur.numberOfInstallments) ch.push(`Tenor: ${cur.numberOfInstallments} → ${s.tenor}`);
      if (Math.abs(s.bank! - cur.amount) > 0.005) ch.push(`Bank payment: ${cur.amount.toLocaleString('en-NG')} → ${s.bank!.toLocaleString('en-NG')}`);
      if (Math.abs((s.bf ?? 0) - (cur.carriedBalance ?? 0)) > 0.005) ch.push(`Balance B/Fwd: ${(cur.carriedBalance ?? 0).toLocaleString('en-NG')} → ${(s.bf ?? 0).toLocaleString('en-NG')}`);
      if (!sameDay(s.paymentDate, cur.startDate)) ch.push('Payment date');
      if (firstPayment && !sameDay(firstPayment, cur.firstPaymentDate)) ch.push('Start date (first repayment)');
      const inputsChanged = ch.length > 0;
      if (!emiSame) ch.push(`EMI: ${cur.installmentAmount.toLocaleString('en-NG')} → ${s.emi!.toLocaleString('en-NG')}`);
      if (!ch.length) { finish(p.customerChanges.length ? 'update-customer' : 'unchanged'); continue; }
      const running = (LIVE_LOAN_STATUSES as readonly string[]).includes(cur.status) || cur.status === 'approved';
      if (running ? !perms.canEditRunning : !perms.canEditLoans) { p.warnings.push(running ? 'Loan changes were ignored: only the CEO can change a loan that is already running.' : 'Loan changes were ignored: you need the permission to edit loans.'); p.loanChanges = []; finish(p.customerChanges.length ? 'update-customer' : 'unchanged'); continue; }
      // a stale EMI (left as it was while other figures changed) is recalculated with the loan's own rule
      const own = { interestRate: cur.interestRate, bankDeductionRate: cur.bankDeductionRate ?? product.bankDeductionRate ?? 0, rateBasis: cur.rateBasis };
      try {
        const { rates } = await pickRates([own], emiSame && inputsChanged ? null : s.emi ?? null);
        const draft = await draftWith(rates); const t = summarise(draft); warnDiffs(t);
        work.loan = cur; work.ratesForEdit = rates; work.draft = draft; work.firstPayment = firstPayment; finish('update-loan');
      } catch (e: any) { err(e?.message ?? 'Could not price this row.'); }
      continue;
    }

    // ---- no Loan ID: a new loan
    const type = s.status === 'TOP UP' || s.status === 'TOPUP' ? 'TOP UP' : s.status === 'NEW' || s.status === '' ? 'NEW' : s.status === 'RENEWAL' ? 'RENEWAL' : null;
    if (!type) { err(`Status "${s.status}" is not understood. Use NEW, TOP UP or RENEWAL.`); continue; }
    p.type = type;
    let oldLoan: any;
    if (type === 'TOP UP') {
      const waiting = theirs.find((l) => ['pending', 'approved'].includes(l.status));
      if (waiting) { err(`${cust.fullName} already has a loan waiting for approval (${waiting.loanId}).`); continue; }
      oldLoan = live[0]; if (!oldLoan) { err(`${cust.fullName} has no running loan to top up. Use NEW (or RENEWAL) for a fresh loan.`); continue; }
      p.topUpOfRef = oldLoan.loanId; if (!s.bf) p.warnings.push('TOP UP row without a Balance B/Fwd: the new loan carries nothing from the old one.');
    } else if (theirs.length) { err(`${cust.fullName} already has a ${theirs[0].status} loan (${theirs[0].loanId}). Mark this row TOP UP to liquidate it, or put the Loan ID in the row to change that loan.`); continue; }
    else if (type === 'NEW' && doneBefore.has(String(cust._id))) p.warnings.push('This customer has repaid loans before; saved as a renewal.');
    try {
      const own = { interestRate: product.interestRate, bankDeductionRate: product.bankDeductionRate ?? 0, rateBasis: product.rateBasis };
      const sheetRates = { interestRate: product.interestRate, bankDeductionRate: product.bankDeductionRate ?? 0, rateBasis: 'per_month' };
      const { rates, how } = await pickRates([own, sheetRates], s.emi ?? null);
      if (!s.emi) { // blank EMI: the sheet's own formulas (interest = principal x rate x tenor, EMI = total / tenor) fill the gaps
        p.warnings.push(`EMI left blank: calculated with the sheet formulas (interest = principal × ${product.interestRate}% × ${s.tenor} months, EMI = total ÷ tenor).`);
        const draft = await draftWith(sheetRates); warnDiffs(summarise(draft)); work.draft = draft;
      } else { const draft = await draftWith(rates); warnDiffs(summarise(draft)); work.draft = draft; void how; }
    } catch (e: any) { err(e?.message ?? 'Could not price this row.'); continue; }
    work.oldLoan = oldLoan; work.extra = { loanType: type === 'TOP UP' ? 'topup' : type === 'RENEWAL' || doneBefore.has(String(cust._id)) ? 'renewal' : 'new' };
    finish(type === 'TOP UP' ? 'top-up' : 'new-loan');
  }
  const n = (f: (r: PlannedRow) => boolean) => rows.filter(f).length;
  return { rows, counts: { newLoans: n((r) => r.action === 'new-loan' || r.action === 'top-up'), loanUpdates: n((r) => r.action === 'update-loan'), customerUpdates: n((r) => !r.isNewCustomer && (r.action === 'update-customer' || (r.action === 'update-loan' && r.customerChanges.length > 0))), newCustomers: n((r) => !!r.isNewCustomer && r.action !== 'error'), unchanged: n((r) => r.action === 'unchanged'), errors: n((r) => r.action === 'error') }, needsApproval: !perms.canApprove, product: products[0]?.name ?? '—' };
}

export const publicPlan = (p: MonthlyPlan) => ({ ...p, rows: p.rows.map(({ _work, ...r }) => r) });

export async function applyMonthlyUpload(buf: Buffer, filename: string, actor: Actor, perms: UploadPerms) {
  const plan = await planMonthlyUpload(buf, perms);
  const results: any[] = [];
  for (const r of plan.rows) {
    const base = { row: r.row, name: r.matchedName ?? r.name, clientId: r.customerRef ?? r.clientId ?? '', ippis: r.ippis, kind: r.type ?? '' };
    if (r.action === 'error' || !r._work) { results.push({ ...base, status: 'skipped', messages: r.errors }); continue; }
    if (r.action === 'unchanged') { results.push({ ...base, status: 'unchanged', messages: r.warnings }); continue; }
    const w = r._work; const messages = [...r.warnings]; let loanId: string | undefined; let loanRef: string | undefined; let status: string = 'updated';
    try {
      if (w.newCustomer) { // a customer that is not in the portal yet: register them (profile incomplete until filled in), then give them the loan
        const t = w.newCustomer.name.split(' '); const ci = (w.custInput ?? {}) as Record<string, any>; const { employment: emp = {}, emergencyContact: ec = {}, ...rest } = ci;
        const doc = await Customer.create({ ...rest, customerId: await nextCustomerId(), firstName: t[0], middleName: t.length > 2 ? t.slice(1, -1).join(' ') : undefined, lastName: t.length > 1 ? t[t.length - 1] : t[0], fullName: w.newCustomer.name, status: rest.status ?? 'active',
          employment: { ...emp, sector: emp.ippisNumber ? 'government' : 'non_government' }, emergencyContact: ec, createdBy: actor.id, updatedBy: actor.id } as any);
        await auditAs(actor, { action: AUDIT.CUSTOMER_CREATED, entity: 'Customer', entityId: String(doc._id), entityLabel: doc.customerId, after: serializeCustomer(doc) });
        w.customer = doc; delete w.custInput; messages.unshift(`New customer registered as ${doc.customerId}; complete their profile.`); status = 'updated';
      } else if (w.custInput) { await updateCustomer(String(w.customer._id), w.custInput as any, actor); messages.unshift(`Customer updated: ${r.customerChanges.join('; ')}`); }
      if (r.action === 'update-loan' && w.loan && w.draft) {
        const t = w.draft.terms;
        await updateLoan(String(w.loan._id), { amount: t.amount, duration: { value: t.numberOfInstallments, unit: 'months' }, numberOfInstallments: t.numberOfInstallments, startDate: t.startDate, ...(w.firstPayment ? { firstPaymentDate: w.firstPayment } : {}), carriedBalance: t.carriedBalance, ...w.ratesForEdit, reason: `Monthly upload (${filename})` }, actor, perms.canEditRunning);
        messages.unshift(`Loan ${w.loan.loanId} updated: ${r.loanChanges.join('; ')}`); loanId = String(w.loan._id); loanRef = w.loan.loanId;
      } else if ((r.action === 'new-loan' || r.action === 'top-up') && w.draft) {
        const { customer, oldLoan, draft, extra } = w; let topUpId: Types.ObjectId | undefined;
        if (oldLoan) {
          const t = await TopUp.create({ topUpId: await nextTopUpId(), customer: customer._id, loan: oldLoan._id, requestedAmount: draft.terms.amount, duration: draft.duration, frequency: 'monthly', interestRate: draft.rates.interestRate, startDate: draft.terms.startDate,
            calculation: { source: 'monthly upload', carriedBalance: draft.terms.carriedBalance, terms: draft.terms, existingLoan: oldLoan.loanId }, notes: `Monthly upload ${filename}`, requestedBy: actor.id } as any);
          topUpId = t._id;
        }
        const loan = await createLoanRecord(draft, { customerId: customer._id, status: 'pending', actorId: actor.id, notes: `Monthly upload (${filename})`, extra: { ...extra, ...(oldLoan ? { topUpOf: oldLoan._id, topUp: topUpId } : {}) } });
        await auditAs(actor, { action: AUDIT.LOAN_CREATED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, after: { customer: customer.customerId, viaMonthlyUpload: filename, type: r.type, totalRepayment: draft.terms.totalRepayment, installments: draft.terms.numberOfInstallments } });
        status = 'pending'; if (perms.canApprove) { await approveLoan(String(loan._id), actor, { system: true }); status = 'active'; }
        loanId = String(loan._id); loanRef = loan.loanId;
      }
      results.push({ ...base, status, ...(loanId ? { loan: loanId, loanRef } : {}), messages });
    } catch (e: any) { results.push({ ...base, status: 'skipped', messages: [...messages, e?.message ?? 'Could not apply this row.'] }); }
  }
  const created = results.filter((x) => x.loan && ['pending', 'active'].includes(x.status)).length;
  const updated = results.filter((x) => x.status === 'updated').length; const skipped = results.filter((x) => x.status === 'skipped').length;
  const rec = await MonthlyUpload.create({ filename, uploadedBy: actor.id, uploadedByName: actor.name, needsApproval: !perms.canApprove, total: results.length, created, updated, skipped, rows: results });
  await auditAs(actor, { action: AUDIT.MONTHLY_UPLOAD, entity: 'MonthlyUpload', entityId: String(rec._id), entityLabel: filename, after: { total: results.length, loansCreated: created, updated, skipped, pendingApproval: !perms.canApprove } });
  return { id: String(rec._id), filename, total: results.length, created, updated, skipped, unchanged: results.filter((x) => x.status === 'unchanged').length, needsApproval: !perms.canApprove, rows: results };
}

export async function listMonthlyUploads() {
  return (await MonthlyUpload.find().sort({ createdAt: -1 }).limit(30).select('-rows').lean()).map((u: any) => ({ id: String(u._id), filename: u.filename, uploadedBy: u.uploadedByName, createdAt: u.createdAt, total: u.total, created: u.created, updated: u.updated ?? 0, skipped: u.skipped, needsApproval: !!u.needsApproval }));
}
export async function getMonthlyUpload(id: string) {
  const u: any = Types.ObjectId.isValid(id) ? await MonthlyUpload.findById(id).lean() : null;
  if (!u) throw AppError.notFound('Upload not found', 'UPLOAD_NOT_FOUND');
  return { ...u, id: String(u._id), _id: undefined };
}

/** An empty copy of the register: the same columns, with the book's formulas ready, for loans that are not in the portal yet. */
export async function monthlyTemplate(company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = company; const ws = wb.addWorksheet('Monthly sheet');
  const heads = ['S/N', 'Clients ID', 'Clients Name', 'IPPIS NO', 'MINISTRY', 'Tenor', 'Payment Date', 'Balance B/Fwd', 'Bank payment', 'Gross Payment', 'Principal', 'Interest', 'Gross Loan', 'EMI', 'Start Date', 'End date', 'Status', 'Loan ID',
    'Customer status', 'Worker type', 'phone no', 'Email', 'Address', 'State', 'Gender', 'MARITAL STATUS', 'DATE OF BIRTH', 'NIN', 'BVN', 'NEXT OF KIN NAME', 'NEXT OF KIN PHONE NO'];
  xlTitleBlock(ws, company, 'Monthly sheet', 'One row per customer. Fill the white columns; the portal calculates gross, principal, interest, loan and EMI. Loan ID empty = new loan (NEW, TOP UP or RENEWAL). Delete the example rows.', heads.length);
  const h = ws.addRow(heads); xlHeaderRow(h, heads.length);
  const first = ws.rowCount + 1;
  const D = (s: string) => new Date(`${s}T00:00:00Z`);
  const blank = (n: number) => Array(n).fill(null);
  const ex: unknown[][] = [
    [1, 'PTC-000551', 'EXAMPLE CLIENT (TOP UP)', 434590, 'OSGF', 12, D('2026-08-04'), 36012.38, 96000, null, null, null, null, null, D('2026-09-01'), null, 'TOP UP', null, ...blank(12)],
    [2, 'PTC-000637', 'EXAMPLE CLIENT (NEW)', 480210, 'LABOUR', 12, D('2026-08-05'), null, 240000, null, null, null, null, null, D('2026-09-01'), null, 'NEW', null, ...blank(12)],
    [3, null, 'EXAMPLE NEW SCHOOL CUSTOMER', null, 'SCHOOL', 12, D('2026-08-25'), null, 288000, null, null, null, null, null, D('2026-09-01'), null, 'NEW', null, ...blank(12)], // no client number or IPPIS: added as a new non-government customer
  ];
  ex.forEach((r) => ws.addRow(r));
  xlStyleBody(ws, first, first + ex.length - 1, ['number', 'text', 'text', 'text', 'text', 'number', 'date', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'date', 'date', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'date', 'text', 'text', 'text', 'text']);
  [6, 12, 30, 12, 18, 7, 14, 15, 15, 16, 16, 15, 16, 14, 14, 14, 12, 12, 14, 16, 14, 24, 24, 14, 10, 14, 14, 14, 14, 22, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  xlFooter(ws, 'Leave Gross Payment, Principal, Interest, Gross Loan and EMI empty: the portal calculates them. Clients are matched by Clients ID (641 or PTC-000641) and IPPIS NO; a row with neither is added as a new customer. Fill the profile columns (right) to complete a profile.', heads.length);
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: h.number }]; xlPrint(ws, { company, headerRow: h.number });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
