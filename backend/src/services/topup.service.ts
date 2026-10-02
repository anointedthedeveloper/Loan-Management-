import { Types } from 'mongoose';
import { Loan } from '../models/Loan.js';
import { TopUp } from '../models/TopUp.js';
import { nextSequence } from '../models/Counter.js';
import { AppError } from '../utils/AppError.js';
import { skipOf } from '../utils/pagination.js';
import { todayLagos } from '../utils/dates.js';
import { AUDIT } from '../config/auditActions.js';
import { LIVE_LOAN_STATUSES } from '../config/loanOptions.js';
import { auditAs } from './AuditService.js';
import { getFinanceRules } from './settings.service.js';
import { recalculateLoan } from './loanLedger.service.js';
import { postTransaction } from './transaction.service.js';
import { assertEligible, buildDraft, createLoanRecord, getLoan } from './loan.service.js';
import { calculateTopUp, type TopUpResult } from './finance/index.js';
import type { Actor } from '../types/index.js';

export const nextTopUpId = async () => `TUP-${String(await nextSequence('topup')).padStart(6, '0')}`;

interface TopUpInput { loanId: string; amount: number; duration: { value: number; unit: string }; frequency: string; customIntervalDays?: number; interestRate?: number; startDate?: Date; notes?: string }

async function loadLiveLoan(loanId: string) {
  const loan = Types.ObjectId.isValid(loanId) ? await Loan.findById(loanId) : null;
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  if (!(LIVE_LOAN_STATUSES as readonly string[]).includes(loan.status)) throw AppError.badRequest(`Top-ups are only available on active loans (this loan is ${loan.status})`, 'TOPUP_NOT_ALLOWED');
  return loan;
}

/** Prices a top-up with the configured rules. Always computed from the *current* ledger position. */
async function price(input: TopUpInput) {
  const loan = await loadLiveLoan(input.loanId);
  await assertEligible(String(loan.customer));
  const { state } = await recalculateLoan(loan._id);
  const rules = await getFinanceRules();
  const startDate = input.startDate ?? todayLagos();
  // The new loan keeps the product (rate, deduction) of the loan being topped up unless a rate is supplied.
  const draft = await buildDraft(
    { productId: String(loan.product), amount: input.amount, duration: input.duration, frequency: input.frequency, customIntervalDays: input.customIntervalDays, startDate },
    { skipLimits: true },
  );
  void draft;
  const existing = { outstandingBalance: state.outstandingBalance, principalBalance: state.principalBalance, totalRepayment: loan.totalRepayment, amountPaid: state.amountPaid };
  const calc = calculateTopUp(existing, input.amount, {
    bankDeductionRate: loan.bankDeductionRate, interestRate: input.interestRate ?? loan.interestRate, rateBasis: loan.rateBasis as any,
    duration: input.duration as any, frequency: input.frequency as any, customIntervalDays: input.customIntervalDays, startDate,
  }, rules.topup);
  return { loan, calc, rules, startDate, state };
}

const calcView = (c: TopUpResult, loan: { loanId: string; outstandingBalance?: number }, state: { outstandingBalance: number }) => ({
  ...c,
  existingLoan: loan.loanId, existingOutstanding: state.outstandingBalance,
  settledOnExistingLoan: c.mode === 'consolidate' ? state.outstandingBalance : 0,
  waivedOnExistingLoan: c.mode === 'consolidate' ? Math.round((state.outstandingBalance - c.carriedBalance) * 100) / 100 : 0,
});

export async function previewTopUp(input: TopUpInput) {
  const { loan, calc, state } = await price(input);
  return calcView(calc, loan, state);
}

export function serializeTopUp(t: any) {
  const o = typeof t.toObject === 'function' ? t.toObject() : t;
  const ref = (x: any, f: (x: any) => object) => (x && typeof x === 'object' && x._id ? { id: String(x._id), ...f(x) } : x ? { id: String(x) } : null);
  return {
    id: String(o._id), topUpId: o.topUpId, status: o.status, requestedAmount: o.requestedAmount, duration: o.duration, frequency: o.frequency, interestRate: o.interestRate,
    startDate: o.startDate, calculation: o.calculation, settlement: o.settlement ?? null, notes: o.notes ?? null, statusReason: o.statusReason ?? null,
    customer: ref(o.customer, (c) => ({ customerId: c.customerId, fullName: c.fullName })), loan: ref(o.loan, (l) => ({ loanId: l.loanId })),
    resultingLoan: ref(o.resultingLoan, (l) => ({ loanId: l.loanId })), requestedBy: ref(o.requestedBy, (u) => ({ name: u.name })), approvedBy: ref(o.approvedBy, (u) => ({ name: u.name })),
    approvedAt: o.approvedAt ?? null, createdAt: o.createdAt,
  };
}
const populateTopUp = [{ path: 'customer', select: 'customerId fullName' }, { path: 'loan', select: 'loanId' }, { path: 'resultingLoan', select: 'loanId' }, { path: 'requestedBy', select: 'name' }, { path: 'approvedBy', select: 'name' }];

export async function requestTopUp(input: TopUpInput, actor: Actor) {
  const { loan, calc, rules, state } = await price(input);
  if (!calc.eligible) throw AppError.badRequest(calc.ineligibleReason ?? 'Not eligible for a top-up', 'TOPUP_NOT_ELIGIBLE');
  if (await TopUp.exists({ loan: loan._id, status: 'pending' })) throw AppError.conflict('There is already a pending top-up request for this loan', 'TOPUP_PENDING_EXISTS');
  const t = await TopUp.create({
    topUpId: await nextTopUpId(), customer: loan.customer, loan: loan._id, requestedAmount: input.amount, duration: input.duration, frequency: input.frequency,
    customIntervalDays: input.customIntervalDays, interestRate: input.interestRate ?? loan.interestRate, startDate: input.startDate ?? todayLagos(),
    calculation: calcView(calc, loan, state), notes: input.notes, requestedBy: actor.id,
  } as any);
  await auditAs(actor, { action: AUDIT.TOPUP_REQUESTED, entity: 'TopUp', entityId: String(t._id), entityLabel: t.topUpId, after: { loan: loan.loanId, amount: input.amount, totalRepayment: calc.terms.totalRepayment, mode: calc.mode } });
  if (!rules.topup.requireApproval) return approveTopUp(String(t._id), actor, { system: true });
  return getTopUp(String(t._id));
}

async function findTopUp(id: string) {
  const t = Types.ObjectId.isValid(id) ? await TopUp.findById(id) : null;
  if (!t) throw AppError.notFound('Top-up not found', 'TOPUP_NOT_FOUND');
  return t;
}

/**
 * Executes a top-up. The position is recalculated at approval time, so payments made since the
 * request are respected. The original loan is never overwritten:
 *  - consolidate: a NEW loan (carried balance + new funds) is created and the old loan is settled by a non-cash ledger entry.
 *  - new_loan: a separate loan is created for the new funds only; the old loan is untouched.
 */
export async function approveTopUp(id: string, actor: Actor, opts: { system?: boolean } = {}) {
  const t = await findTopUp(id);
  if (t.status !== 'pending') throw AppError.conflict(`Only pending top-ups can be approved (this one is ${t.status})`, 'INVALID_TOPUP_STATE');
  const rules = await getFinanceRules();
  if (!opts.system && rules.loans.preventSelfApproval && String(t.requestedBy) === actor.id) throw AppError.forbidden('You cannot approve a top-up you requested', 'SELF_APPROVAL_BLOCKED');
  const { loan, calc, state } = await price({ loanId: String(t.loan), amount: t.requestedAmount, duration: t.duration as any, frequency: t.frequency!, customIntervalDays: t.customIntervalDays ?? undefined, interestRate: t.interestRate ?? undefined, startDate: t.startDate ?? undefined });
  if (!calc.eligible) throw AppError.badRequest(calc.ineligibleReason ?? 'Not eligible for a top-up', 'TOPUP_NOT_ELIGIBLE');

  const draft = await buildDraft(
    { productId: String(loan.product), amount: t.requestedAmount, duration: t.duration as any, frequency: t.frequency!, customIntervalDays: t.customIntervalDays ?? undefined, startDate: t.startDate ?? todayLagos() },
    { skipLimits: true, carriedBalance: calc.carriedBalance, interestBasis: rules.topup.mode === 'consolidate' ? rules.topup.interestBasis : 'full_principal' },
  );
  if (t.interestRate !== undefined && t.interestRate !== null && t.interestRate !== loan.interestRate) {
    // honour a rate override: reprice with the overridden rate using the same engine
    const { calculateLoan, generateSchedule } = await import('./finance/index.js');
    draft.terms = calculateLoan({ amount: t.requestedAmount, carriedBalance: calc.carriedBalance, bankDeductionRate: loan.bankDeductionRate, interestRate: t.interestRate, rateBasis: loan.rateBasis as any, duration: t.duration as any, frequency: t.frequency as any, customIntervalDays: t.customIntervalDays ?? undefined, interestBasis: draft.interestBasis as any, startDate: t.startDate ?? todayLagos() });
    draft.schedule = generateSchedule(draft.terms, draft.frequency, t.customIntervalDays ?? undefined);
  }
  const newLoan = await createLoanRecord(draft, {
    customerId: loan.customer, status: 'active', actorId: actor.id, notes: `Top-up ${t.topUpId} on ${loan.loanId}`,
    extra: { topUpOf: loan._id, topUp: t._id, interestRate: t.interestRate ?? loan.interestRate, approvedBy: actor.id, approvedAt: new Date(), disbursedAt: new Date() },
  });
  await postTransaction({ customer: loan.customer, loan: newLoan._id, topUp: t._id, type: 'topup', amount: t.requestedAmount, description: `Top-up ${t.topUpId} disbursement`, createdBy: actor.id });

  let settlement: Record<string, unknown> | null = null;
  if (rules.topup.mode === 'consolidate') {
    await postTransaction({ customer: loan.customer, loan: loan._id, topUp: t._id, type: 'topup', amount: state.outstandingBalance, isCash: false, affectsLoanBalance: true,
      description: `Balance settled by top-up ${t.topUpId} into ${newLoan.loanId}`, createdBy: actor.id });
    await Loan.updateOne({ _id: loan._id }, { settledByTopUp: t._id });
    settlement = { settled: state.outstandingBalance, carriedForward: calc.carriedBalance, waived: Math.round((state.outstandingBalance - calc.carriedBalance) * 100) / 100, intoLoan: newLoan.loanId };
    await recalculateLoan(loan._id);
  }
  await recalculateLoan(newLoan._id);

  t.status = 'approved'; t.approvedBy = new Types.ObjectId(actor.id); t.approvedAt = new Date(); t.resultingLoan = newLoan._id; t.settlement = settlement;
  t.calculation = calcView(calc, loan, state);
  await t.save();
  await auditAs(actor, { action: AUDIT.TOPUP_APPROVED, entity: 'TopUp', entityId: String(t._id), entityLabel: t.topUpId, before: { status: 'pending' }, after: { status: 'approved', newLoan: newLoan.loanId, settlement } });
  await auditAs(actor, { action: AUDIT.LOAN_CREATED, entity: 'Loan', entityId: String(newLoan._id), entityLabel: newLoan.loanId, after: { viaTopUp: t.topUpId, totalRepayment: draft.terms.totalRepayment } });
  return getTopUp(id);
}

async function close(id: string, actor: Actor, to: 'rejected' | 'cancelled', reason?: string) {
  const t = await findTopUp(id);
  if (t.status !== 'pending') throw AppError.conflict(`Only pending top-ups can be ${to} (this one is ${t.status})`, 'INVALID_TOPUP_STATE');
  t.status = to; t.statusReason = reason; await t.save();
  await auditAs(actor, { action: to === 'rejected' ? AUDIT.TOPUP_REJECTED : AUDIT.TOPUP_CANCELLED, entity: 'TopUp', entityId: String(t._id), entityLabel: t.topUpId, before: { status: 'pending' }, after: { status: to, reason } });
  return getTopUp(id);
}
export const rejectTopUp = (id: string, reason: string, actor: Actor) => close(id, actor, 'rejected', reason);
export const cancelTopUp = (id: string, reason: string | undefined, actor: Actor) => close(id, actor, 'cancelled', reason);

export async function getTopUp(id: string) {
  const t = Types.ObjectId.isValid(id) ? await TopUp.findById(id).populate(populateTopUp) : null;
  if (!t) throw AppError.notFound('Top-up not found', 'TOPUP_NOT_FOUND');
  return serializeTopUp(t);
}
export async function listTopUps(q: any) {
  const f: Record<string, any> = {};
  if (q.status) f.status = q.status; if (q.customer) f.customer = q.customer; if (q.loan) f.loan = q.loan;
  if (q.from || q.to) f.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  const [rows, total] = await Promise.all([TopUp.find(f).sort({ createdAt: -1 }).skip(skipOf(q)).limit(q.limit).populate(populateTopUp), TopUp.countDocuments(f)]);
  return { items: rows.map(serializeTopUp), total };
}
export { getLoan };
