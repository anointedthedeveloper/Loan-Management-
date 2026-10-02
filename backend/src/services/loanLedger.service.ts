import { Types } from 'mongoose';
import { Loan } from '../models/Loan.js';
import { RepaymentSchedule } from '../models/RepaymentSchedule.js';
import { Transaction } from '../models/Transaction.js';
import { toKobo } from '../utils/money.js';
import { todayLagos } from '../utils/dates.js';
import { AUDIT } from '../config/auditActions.js';
import { recordAudit } from './AuditService.js';
import { getFinanceRules } from './settings.service.js';
import { computeLoanState, resolveStatus, type LoanState } from './finance/index.js';

/**
 * Rebuilds a loan's derived balances, schedule status and loan status from the transaction ledger.
 * Safe to call any time (idempotent): payments, reversals and the nightly overdue job all use it.
 */
export async function recalculateLoan(loanId: Types.ObjectId | string, opts: { today?: Date } = {}): Promise<{ state: LoanState; status: string; changed: boolean }> {
  const loan = await Loan.findById(loanId);
  const schedule = await RepaymentSchedule.findOne({ loan: loan?._id });
  if (!loan || !schedule) throw new Error(`Loan or schedule not found for ${String(loanId)}`);
  const rules = await getFinanceRules();
  const payments = await Transaction.find({ loan: loan._id, affectsLoanBalance: true, reversedAt: { $exists: false } }).sort({ date: 1, createdAt: 1, _id: 1 });

  const plan = schedule.installments.map((i) => ({ number: i.number, dueDate: i.dueDate, principalComponent: i.principalComponent, interestComponent: i.interestComponent }));
  const state = computeLoanState(plan, payments.map((p) => ({ id: String(p._id), amountKobo: toKobo(p.amount) })), opts.today ?? todayLagos(), rules.repayment, rules.latePayment.graceDays);
  const status = resolveStatus(loan.status, state, { defaultAfterDays: rules.latePayment.defaultAfterDays });

  schedule.set('installments', state.installments.map((i) => ({ ...i })));
  await schedule.save();

  const ops: any[] = payments.map((p) => ({ updateOne: { filter: { _id: p._id }, update: { $set: { allocations: (state.allocationsByPayment[String(p._id)] ?? []).map((a) => ({ number: a.number, principal: a.principal / 100, interest: a.interest / 100 })) } } } }));
  if (ops.length) await Transaction.bulkWrite(ops);

  const before = loan.status;
  await Loan.updateOne({ _id: loan._id }, { $set: {
    status, amountPaid: state.amountPaid, principalPaid: state.principalPaid, interestPaid: state.interestPaid,
    principalBalance: state.principalBalance, interestBalance: state.interestBalance, outstandingBalance: state.outstandingBalance, creditBalance: state.creditBalance,
    nextInstallmentNumber: state.nextInstallmentNumber, nextDueDate: state.nextDueDate, nextInstallmentAmount: state.nextInstallmentAmount,
    daysOverdue: state.daysOverdue, overdueAmount: state.overdueAmount, lastRecalculatedAt: new Date(),
  } });
  if (before !== status) await recordAudit({ userName: 'System', action: AUDIT.LOAN_STATUS_CHANGED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, before: { status: before }, after: { status } });
  return { state, status, changed: before !== status };
}

/** Nightly / on-demand sweep so overdue and completed states stay current without anyone opening the loan. */
export async function refreshLiveLoans(): Promise<{ checked: number; changed: number }> {
  const loans = await Loan.find({ status: { $in: ['active', 'overdue', 'defaulted'] } }).select('_id');
  let changed = 0;
  for (const l of loans) { try { if ((await recalculateLoan(l._id)).changed) changed++; } catch (e) { console.error('refresh failed for', String(l._id), e); } }
  return { checked: loans.length, changed };
}
