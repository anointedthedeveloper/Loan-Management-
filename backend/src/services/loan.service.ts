import { Types } from 'mongoose';
import { Transaction } from '../models/Transaction.js';
import { Loan } from '../models/Loan.js';
import { Customer } from '../models/Customer.js';
import { RepaymentSchedule } from '../models/RepaymentSchedule.js';
import { nextSequence } from '../models/Counter.js';
import { AppError } from '../utils/AppError.js';
import { changedFields } from '../utils/diff.js';
import { skipOf } from '../utils/pagination.js';
import { isoDate, todayLagos } from '../utils/dates.js';
import { AUDIT } from '../config/auditActions.js';
import { LIVE_LOAN_STATUSES, loanStatus, type Frequency } from '../config/loanOptions.js';
import { CUSTOMER_STATUSES } from '../config/customerOptions.js';
import { auditAs } from './AuditService.js';
import { getProduct } from './product.service.js';
import { getFinanceRules } from './settings.service.js';
import { recalculateLoan } from './loanLedger.service.js';
import { postTransaction } from './transaction.service.js';
import { calculateLoan, durationInMonths, generateSchedule, type LoanTerms, type LoanTermsInput } from './finance/index.js';
import type { Actor } from '../types/index.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const nextLoanId = async () => `LN-${String(await nextSequence('loan')).padStart(6, '0')}`;
const NON_TERMINAL = ['pending', 'approved', ...LIVE_LOAN_STATUSES];

/* ---------------- serialization ---------------- */
export function serializeLoan(l: any) {
  const o = typeof l.toObject === 'function' ? l.toObject() : l;
  const { __v, ...r } = o;
  const c = o.customer;
  return {
    ...r, id: String(o._id), _id: undefined,
    customer: c && typeof c === 'object' && c._id ? { id: String(c._id), customerId: c.customerId, fullName: c.fullName, phone: c.phone, ippisNumber: c.employment?.ippisNumber ?? null, ministry: c.employment?.ministry ?? null } : { id: String(c) },
    product: o.product ? String(o.product._id ?? o.product) : null,
    createdBy: o.createdBy && typeof o.createdBy === 'object' && o.createdBy.name ? { id: String(o.createdBy._id), name: o.createdBy.name } : o.createdBy ? { id: String(o.createdBy) } : null,
    approvedBy: o.approvedBy && typeof o.approvedBy === 'object' && o.approvedBy.name ? { id: String(o.approvedBy._id), name: o.approvedBy.name } : null,
    topUpOf: o.topUpOf ? String(o.topUpOf) : null, topUp: o.topUp ? String(o.topUp) : null, settledByTopUp: o.settledByTopUp ? String(o.settledByTopUp) : null,
  };
}
const populateLoan = [{ path: 'customer', select: 'customerId fullName phone employment.ippisNumber employment.ministry' }, { path: 'createdBy', select: 'name' }, { path: 'approvedBy', select: 'name' }];

/* ---------------- pricing ---------------- */
export interface PricingInput {
  productId: string; amount: number; duration?: { value: number; unit: string }; frequency?: string; customIntervalDays?: number;
  numberOfInstallments?: number; startDate: Date; firstPaymentDate?: Date;
}
type ProductDoc = Awaited<ReturnType<typeof getProduct>>;

export function assertWithinProduct(p: ProductDoc, i: { amount: number; duration: { value: number; unit: string }; frequency: string }) {
  const err = (field: string, msg: string) => AppError.badRequest(msg, 'PRODUCT_LIMIT', { [field]: msg });
  if (!p.isActive) throw AppError.badRequest('This loan product is not active', 'PRODUCT_INACTIVE', { productId: 'Product is inactive' });
  if (p.minAmount && i.amount < p.minAmount) throw err('amount', `Minimum amount for ${p.name} is ₦${p.minAmount.toLocaleString('en-NG')}`);
  if (p.maxAmount && i.amount > p.maxAmount) throw err('amount', `Maximum amount for ${p.name} is ₦${p.maxAmount.toLocaleString('en-NG')}`);
  const months = durationInMonths(i.duration as any);
  if (p.minDuration && months < durationInMonths({ value: p.minDuration, unit: p.durationUnit as any }) - 1e-9) throw err('duration', `Minimum duration is ${p.minDuration} ${p.durationUnit}`);
  if (p.maxDuration && months > durationInMonths({ value: p.maxDuration, unit: p.durationUnit as any }) + 1e-9) throw err('duration', `Maximum duration is ${p.maxDuration} ${p.durationUnit}`);
  if (!p.allowedFrequencies.includes(i.frequency)) throw err('frequency', `${p.name} does not allow ${i.frequency} repayments`);
}

export interface Draft { firstPaymentDate?: Date; product: ProductDoc; rates: { interestRate: number; bankDeductionRate: number; rateBasis: string }; terms: LoanTerms; frequency: Frequency; duration: { value: number; unit: string }; customIntervalDays?: number; interestBasis: string; schedule: ReturnType<typeof generateSchedule> }

/** Prices a loan from a product + request using the central engine. Used by preview, create and edit. */
export async function buildDraft(input: PricingInput, extra: { carriedBalance?: number; interestBasis?: LoanTermsInput['interestBasis']; skipLimits?: boolean; rates?: { interestRate: number; bankDeductionRate: number; rateBasis: string } } = {}): Promise<Draft> {
  const product = await getProduct(input.productId);
  let duration = (input.duration ?? { value: product.minDuration, unit: product.durationUnit }) as { value: number; unit: string };
  const frequency = (input.frequency ?? product.defaultFrequency) as Frequency;
  // Monthly loans: an explicit installment count is the tenor in months (keeps duration, interest and schedule consistent).
  if (frequency === 'monthly' && input.numberOfInstallments) duration = { value: input.numberOfInstallments, unit: 'months' };
  if (!extra.skipLimits) assertWithinProduct(product, { amount: input.amount, duration, frequency });
  if (frequency === 'custom' && !input.customIntervalDays) throw AppError.badRequest('Enter the repayment interval in days', 'VALIDATION_ERROR', { customIntervalDays: 'Required for custom frequency' });
  const rules = await getFinanceRules();
  if (input.firstPaymentDate && input.firstPaymentDate < input.startDate) throw AppError.badRequest('The first payment cannot be before the start date', 'VALIDATION_ERROR', { firstPaymentDate: 'Cannot be before the start date' });
  if (!rules.loans.allowBackdatedStart && input.startDate < todayLagos()) throw AppError.badRequest('Start date cannot be in the past', 'VALIDATION_ERROR', { startDate: 'Cannot be in the past' });
  const interestBasis = extra.interestBasis ?? 'full_principal';
  const rates = extra.rates ?? { interestRate: product.interestRate, bankDeductionRate: product.bankDeductionRate, rateBasis: product.rateBasis };
  let terms: LoanTerms;
  try {
    terms = calculateLoan({
      amount: input.amount, carriedBalance: extra.carriedBalance, bankDeductionRate: rates.bankDeductionRate, interestRate: rates.interestRate,
      rateBasis: rates.rateBasis as any, duration: duration as any, frequency, customIntervalDays: input.customIntervalDays,
      numberOfInstallments: input.numberOfInstallments, interestBasis, startDate: input.startDate, firstPaymentDate: input.firstPaymentDate,
    });
  } catch (e) { throw AppError.badRequest((e as Error).message, 'CALCULATION_ERROR'); }
  return { product, terms, rates, frequency, duration, customIntervalDays: input.customIntervalDays, interestBasis, firstPaymentDate: input.firstPaymentDate, schedule: generateSchedule(terms, frequency, input.customIntervalDays) };
}

export const draftView = (d: Draft) => ({
  product: { id: String(d.product._id), name: d.product.name, code: d.product.code, interestRate: d.product.interestRate, rateBasis: d.product.rateBasis, bankDeductionRate: d.product.bankDeductionRate },
  frequency: d.frequency, duration: d.duration, terms: d.terms,
  schedule: d.schedule.map((s) => ({ ...s, remaining: s.expectedAmount, amountPaid: 0, status: 'upcoming' })),
});

/* ---------------- eligibility (extension point) ---------------- */
export async function assertEligible(customerId: string, opts: { newLoan?: boolean } = {}) {
  const c = await Customer.findOne({ _id: customerId, isArchived: false });
  if (!c) throw AppError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  const status = CUSTOMER_STATUSES.find((s) => s.value === c.status);
  if (!status?.canBorrow) throw AppError.badRequest(`${c.fullName} is ${status?.label.toLowerCase() ?? c.status} and cannot be given a loan`, 'LOAN_NOT_ELIGIBLE');
  if (!opts.newLoan) return c;
  // A customer with a pending or running loan gets a top-up, not a second loan (limit is configurable; default 1).
  const { loans } = await getFinanceRules();
  const limit = loans.maxActiveLoansPerCustomer || 1;
  const open = await Loan.find({ customer: c._id, status: { $in: NON_TERMINAL } }).select('loanId status').sort({ createdAt: -1 }).limit(5);
  if (open.length >= limit) {
    const l = open[0]!;
    throw new AppError(409, `${c.fullName} already has a ${l.status} loan (${l.loanId}). Please do a top-up on that loan instead of creating another one.`, 'EXISTING_LOAN',
      { existingLoanId: String(l._id), existingLoanRef: l.loanId, existingStatus: l.status });
  }
  return c;
}

export async function previewLoan(input: PricingInput & { customerId?: string; loanId?: string; interestRate?: number; bankDeductionRate?: number; rateBasis?: string }) {
  if (input.loanId) { // previewing an edit of an existing loan
    const loan = await findLoan(input.loanId);
    const running = RUNNING_EDITABLE.includes(loan.status);
    return draftView(await buildDraft(input, { carriedBalance: loan.carriedBalance || undefined, interestBasis: loan.interestBasis as any, skipLimits: running,
      rates: running ? { interestRate: input.interestRate ?? loan.interestRate, bankDeductionRate: input.bankDeductionRate ?? loan.bankDeductionRate, rateBasis: input.rateBasis ?? loan.rateBasis } : undefined }));
  }
  if (input.customerId) await assertEligible(input.customerId, { newLoan: true });
  return draftView(await buildDraft(input));
}

/* ---------------- create / update ---------------- */
export async function createLoanRecord(d: Draft, opts: { customerId: Types.ObjectId | string; status: string; actorId?: string; notes?: string; extra?: Record<string, unknown> }) {
  const t = d.terms;
  const loanType = (opts.extra as { loanType?: string } | undefined)?.loanType ?? ((await Loan.exists({ customer: opts.customerId, status: { $in: ['active', 'overdue', 'defaulted', 'completed'] } })) ? 'renewal' : 'new');
  const loan = await Loan.create({
    loanId: await nextLoanId(), customer: opts.customerId, product: d.product._id, productName: d.product.name, status: opts.status,
    amount: t.amount, carriedBalance: t.carriedBalance, bankDeductionRate: t.bankDeductionRate, grossAmount: t.grossAmount, principal: t.principal,
    interestRate: d.product.interestRate, rateBasis: d.product.rateBasis, interestBasis: d.interestBasis, interestAmount: t.interestAmount, monthlyInterest: t.monthlyInterest, totalRepayment: t.totalRepayment,
    duration: d.duration, frequency: d.frequency, customIntervalDays: d.customIntervalDays, numberOfInstallments: t.numberOfInstallments, installmentAmount: t.installmentAmount,
    startDate: t.startDate, firstPaymentDate: t.firstDueDate, firstPaymentDateIsCustom: !!d.firstPaymentDate, dueDate: t.dueDate, outstandingBalance: t.totalRepayment, principalBalance: t.principal, interestBalance: t.interestAmount,
    notes: opts.notes, createdBy: opts.actorId, updatedBy: opts.actorId, ...(opts.extra ?? {}), loanType,
  } as any);
  await RepaymentSchedule.create({ loan: loan._id, installments: d.schedule.map((s) => ({ ...s, paidPrincipal: 0, paidInterest: 0, amountPaid: 0, remaining: s.expectedAmount, status: 'upcoming' })) });
  return loan;
}

/** `autoApprove`: set by the API when the creator holds loans.approve (e.g. the CEO), so approvers never approve their own work. */
export async function createLoan(input: PricingInput & { customerId: string; notes?: string }, actor: Actor, opts: { autoApprove?: boolean } = {}) {
  await assertEligible(input.customerId, { newLoan: true });
  const draft = await buildDraft(input);
  const loan = await createLoanRecord(draft, { customerId: input.customerId, status: 'pending', actorId: actor.id, notes: input.notes });
  await auditAs(actor, { action: AUDIT.LOAN_CREATED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, after: { customer: input.customerId, product: draft.product.code, amount: draft.terms.amount, totalRepayment: draft.terms.totalRepayment, installments: draft.terms.numberOfInstallments } });
  const { loans } = await getFinanceRules();
  if (!loans.requireApproval || opts.autoApprove) return approveLoan(String(loan._id), actor, { system: true });
  return getLoan(String(loan._id));
}

async function findLoan(id: string) {
  const l = Types.ObjectId.isValid(id) ? await Loan.findById(id) : null;
  if (!l) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  return l;
}

const RUNNING_EDITABLE = ['approved', 'active', 'overdue', 'defaulted'];

/**
 * Pending loans are edited by anyone with loans.edit. Running loans (approved/active/overdue/defaulted) can be edited by
 * those with loans.editActive (the CEO): terms are re-priced, the schedule is rebuilt and every recorded repayment is
 * replayed over it, so balances and statuses stay consistent. The change is audited with before/after values and a reason.
 */
export async function updateLoan(id: string, input: Partial<PricingInput> & { notes?: string; interestRate?: number; bankDeductionRate?: number; rateBasis?: string; reason?: string }, actor: Actor, canEditRunning = false) {
  const loan = await findLoan(id);
  const running = RUNNING_EDITABLE.includes(loan.status);
  if (loan.status !== 'pending' && !running) throw AppError.conflict(`A ${loan.status} loan cannot be edited.`, 'LOAN_NOT_EDITABLE');
  if (running && !canEditRunning) throw AppError.forbidden('Only an administrator can edit a loan that has already been approved. You can edit it while it is pending.', 'LOAN_NOT_EDITABLE');
  const before = serializeLoan(loan);
  const merged: PricingInput = {
    productId: input.productId ?? String(loan.product), amount: input.amount ?? loan.amount, duration: input.duration ?? { value: loan.duration!.value!, unit: loan.duration!.unit! },
    frequency: input.frequency ?? loan.frequency, customIntervalDays: input.customIntervalDays ?? loan.customIntervalDays ?? undefined,
    numberOfInstallments: input.numberOfInstallments, startDate: input.startDate ?? loan.startDate,
    firstPaymentDate: input.firstPaymentDate ?? (loan.firstPaymentDateIsCustom ? loan.firstPaymentDate ?? undefined : undefined),
  };
  const d = await buildDraft(merged, { carriedBalance: loan.carriedBalance || undefined, interestBasis: loan.interestBasis as any, skipLimits: running, rates: running ? { interestRate: input.interestRate ?? loan.interestRate, bankDeductionRate: input.bankDeductionRate ?? loan.bankDeductionRate, rateBasis: input.rateBasis ?? loan.rateBasis } : undefined });
  const t = d.terms;
  loan.set({ product: d.product._id, productName: d.product.name, amount: t.amount, carriedBalance: t.carriedBalance, bankDeductionRate: t.bankDeductionRate, grossAmount: t.grossAmount, principal: t.principal,
    interestRate: d.product.interestRate, rateBasis: d.product.rateBasis, interestAmount: t.interestAmount, monthlyInterest: t.monthlyInterest, totalRepayment: t.totalRepayment, duration: d.duration, frequency: d.frequency,
    customIntervalDays: d.customIntervalDays, numberOfInstallments: t.numberOfInstallments, installmentAmount: t.installmentAmount, startDate: t.startDate, firstPaymentDate: t.firstDueDate, firstPaymentDateIsCustom: !!d.firstPaymentDate, dueDate: t.dueDate,
    outstandingBalance: t.totalRepayment, principalBalance: t.principal, interestBalance: t.interestAmount, ...(input.notes !== undefined && { notes: input.notes }), updatedBy: actor.id });
  if (running) loan.set({ interestRate: d.rates.interestRate, bankDeductionRate: d.rates.bankDeductionRate, rateBasis: d.rates.rateBasis });
  await loan.save();
  await RepaymentSchedule.updateOne({ loan: loan._id }, { $set: { installments: d.schedule.map((s) => ({ ...s, paidPrincipal: 0, paidInterest: 0, amountPaid: 0, remaining: s.expectedAmount, status: 'upcoming' })) } });
  if (running) {
    // The payout entry follows the loan's amount and start date (same ledger row, change recorded in the audit trail).
    const payout = await Transaction.findOne({ loan: loan._id, type: 'disbursement', reversedAt: { $exists: false } });
    const today = todayLagos();
    if (payout) await Transaction.updateOne({ _id: payout._id }, { amount: loan.amount, date: loan.startDate < today ? loan.startDate : today });
    await recalculateLoan(loan._id);
  }
  const fresh = running ? await Loan.findById(loan._id) : loan;
  const after = serializeLoan(fresh);
  const diff = changedFields(before, after, ['updatedAt', 'updatedBy', 'dueDate', 'startDate', 'duration']);
  await auditAs(actor, { action: AUDIT.LOAN_UPDATED, entity: 'Loan', entityId: after.id, entityLabel: loan.loanId, before: diff.before, after: running ? { ...diff.after, ...(input.reason ? { reason: input.reason } : {}), editedWhileStatus: loan.status } : diff.after });
  return getLoan(id);
}

/* ---------------- workflow ---------------- */
export async function approveLoan(id: string, actor: Actor, opts: { system?: boolean } = {}) {
  const loan = await findLoan(id);
  if (loan.status !== 'pending') throw AppError.conflict(`Only pending loans can be approved (this loan is ${loan.status})`, 'INVALID_LOAN_STATE');
  const rules = await getFinanceRules();
  if (!opts.system && rules.loans.preventSelfApproval && String(loan.createdBy) === actor.id) throw AppError.forbidden('You cannot approve a loan you created', 'SELF_APPROVAL_BLOCKED');
  await assertEligible(String(loan.customer));
  loan.status = 'approved'; loan.approvedBy = new Types.ObjectId(actor.id); loan.approvedAt = new Date(); loan.updatedBy = loan.approvedBy;
  await loan.save();
  await auditAs(actor, { action: AUDIT.LOAN_APPROVED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, before: { status: 'pending' }, after: { status: 'approved' } });
  if (rules.loans.autoDisburseOnApproval) return disburseLoan(id, actor);
  return getLoan(id);
}

/** Pays out an approved loan: writes the disbursement to the ledger and activates the loan. */
export async function disburseLoan(id: string, actor: Actor) {
  const loan = await findLoan(id);
  if (loan.status !== 'approved') throw AppError.conflict(`Only approved loans can be disbursed (this loan is ${loan.status})`, 'INVALID_LOAN_STATE');
  // The payout is dated the loan's payment (start) date; a future start date is paid out now.
  const today = todayLagos();
  await postTransaction({ customer: loan.customer, loan: loan._id, type: 'disbursement', amount: loan.amount, date: loan.startDate < today ? loan.startDate : today, description: `Loan disbursement ${loan.loanId}`, createdBy: actor.id });
  loan.status = 'active'; loan.disbursedAt = new Date(); await loan.save();
  await recalculateLoan(loan._id);
  await auditAs(actor, { action: AUDIT.LOAN_DISBURSED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, after: { amount: loan.amount } });
  return getLoan(id);
}

async function closeWithReason(id: string, actor: Actor, reason: string, to: 'rejected' | 'cancelled' | 'defaulted') {
  const loan = await findLoan(id);
  const from = loan.status;
  const allowed = { rejected: ['pending'], cancelled: ['pending', 'approved'], defaulted: ['active', 'overdue'] }[to];
  if (!allowed.includes(from)) throw AppError.conflict(`A ${from} loan cannot be ${to}`, 'INVALID_LOAN_STATE');
  loan.status = to; loan.statusReason = reason; loan.updatedBy = new Types.ObjectId(actor.id);
  if (to === 'rejected') { loan.rejectedBy = loan.updatedBy; loan.rejectedAt = new Date(); }
  await loan.save();
  const action = { rejected: AUDIT.LOAN_REJECTED, cancelled: AUDIT.LOAN_CANCELLED, defaulted: AUDIT.LOAN_DEFAULTED }[to];
  await auditAs(actor, { action, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, before: { status: from }, after: { status: to, reason } });
  return getLoan(id);
}
export const rejectLoan = (id: string, reason: string, actor: Actor) => closeWithReason(id, actor, reason, 'rejected');
export const cancelLoan = (id: string, reason: string, actor: Actor) => closeWithReason(id, actor, reason, 'cancelled');
export const markLoanDefaulted = (id: string, reason: string, actor: Actor) => closeWithReason(id, actor, reason, 'defaulted');

/* ---------------- reads ---------------- */
export async function getLoan(id: string) {
  const loan = await findLoan(id);
  // Overdue/completed are date-driven, so refresh once per day (and on every payment / nightly job), not on every view.
  const staleToday = !loan.lastRecalculatedAt || isoDate(todayLagos(loan.lastRecalculatedAt)) !== isoDate(todayLagos());
  if (staleToday && (!loanStatus(loan.status)?.manual || loan.status === 'defaulted')) await recalculateLoan(loan._id);
  const fresh = await Loan.findById(loan._id).populate(populateLoan);
  const schedule = await RepaymentSchedule.findOne({ loan: loan._id }).lean();
  return { loan: serializeLoan(fresh!), schedule: (schedule?.installments ?? []).map(({ ...i }) => i) };
}

export async function listLoans(q: any) {
  const f: Record<string, any> = {};
  if (q.status?.length) f.status = { $in: q.status };
  else if (q.scope === 'completed') f.status = 'completed'; // fully repaid loans live on their own page
  else if (q.scope !== 'all') f.status = { $ne: 'completed' };
  if (q.customer) f.customer = q.customer;
  if (q.createdBy) f.createdBy = q.createdBy;
  if (q.product) f.product = q.product;
  if (q.from || q.to) f.startDate = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.minAmount !== undefined || q.maxAmount !== undefined) f.amount = { ...(q.minAmount !== undefined && { $gte: q.minAmount }), ...(q.maxAmount !== undefined && { $lte: q.maxAmount }) };
  if (q.repaymentStatus === 'unpaid') Object.assign(f, { amountPaid: 0, status: { $in: ['active', 'overdue', 'defaulted'] } });
  if (q.repaymentStatus === 'partial') Object.assign(f, { amountPaid: { $gt: 0 }, outstandingBalance: { $gt: 0 }, status: { $in: ['active', 'overdue', 'defaulted'] } });
  if (q.repaymentStatus === 'paid') f.status = 'completed';
  if (q.repaymentStatus === 'overdue') f.overdueAmount = { $gt: 0 };
  if (q.q) {
    const re = new RegExp(escapeRe(q.q), 'i');
    const cust = await Customer.find({ $or: [{ fullName: re }, { customerId: re }, { phone: re }] }).select('_id').limit(200);
    f.$or = [{ loanId: re }, { customer: { $in: cust.map((c) => c._id) } }];
  }
  const sort: Record<string, 1 | -1> = { [q.sort]: q.order === 'asc' ? 1 : -1, _id: -1 };
  const [rows, total] = await Promise.all([Loan.find(f).sort(sort).skip(skipOf(q)).limit(q.limit).populate(populateLoan), Loan.countDocuments(f)]);
  return { items: rows.map(serializeLoan), total };
}
