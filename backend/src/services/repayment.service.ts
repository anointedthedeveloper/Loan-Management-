import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { AppError } from '../utils/AppError.js';
import { todayLagos, diffDays } from '../utils/dates.js';
import { AUDIT } from '../config/auditActions.js';
import { loanStatus } from '../config/loanOptions.js';
import { auditAs } from './AuditService.js';
import { getFinanceRules } from './settings.service.js';
import { recalculateLoan } from './loanLedger.service.js';
import { assertReference, listTransactions, postTransaction, serializeTransaction } from './transaction.service.js';
import { getLoan } from './loan.service.js';
import { toKobo } from '../utils/money.js';
import type { Actor } from '../types/index.js';

/**
 * Records a repayment: validate -> ledger entry -> replay balances/schedule/status -> audit.
 * The loan's balances are never edited directly; they are rebuilt from the ledger.
 */
export async function recordRepayment(input: { loanId: string; amount: number; date?: Date; method?: string; reference?: string; description?: string }, actor: Actor) {
  const loan = await Loan.findById(input.loanId);
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  if (!loanStatus(loan.status)?.acceptsRepayments) throw AppError.badRequest(`Repayments cannot be recorded on a ${loan.status} loan`, 'REPAYMENT_NOT_ALLOWED');
  const rules = await getFinanceRules();
  const date = input.date ?? todayLagos();
  if (!rules.repayment.allowFutureDatedPayments && diffDays(date, todayLagos()) > 0) throw AppError.badRequest('Payment date cannot be in the future', 'VALIDATION_ERROR', { date: 'Cannot be in the future' });
  if (diffDays(date, loan.startDate) < -3650) throw AppError.badRequest('Payment date is unrealistic', 'VALIDATION_ERROR', { date: 'Check the date' });

  const { state: current } = await recalculateLoan(loan._id);
  if (toKobo(input.amount) > toKobo(current.outstandingBalance) && rules.repayment.overpaymentPolicy === 'reject')
    throw AppError.badRequest(`Payment exceeds the outstanding balance of ₦${current.outstandingBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`, 'OVERPAYMENT', { amount: 'More than the outstanding balance' });
  await assertReference(input, String(loan._id));

  const tx = await postTransaction({ customer: loan.customer, loan: loan._id, type: 'repayment', amount: input.amount, date, method: input.method, reference: input.reference,
    description: input.description ?? `Repayment on ${loan.loanId}`, affectsLoanBalance: true, createdBy: actor.id });
  const { state, status } = await recalculateLoan(loan._id);
  await auditAs(actor, { action: AUDIT.REPAYMENT_RECORDED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId,
    before: { outstandingBalance: current.outstandingBalance, status: loan.status },
    after: { transaction: tx.transactionId, amount: input.amount, outstandingBalance: state.outstandingBalance, status } });
  const fresh = await Transaction.findById(tx._id).populate([{ path: 'customer', select: 'customerId fullName' }, { path: 'loan', select: 'loanId' }, { path: 'createdBy', select: 'name' }]);
  return { transaction: serializeTransaction(fresh), ...(await getLoan(String(loan._id))) };
}

export const listRepayments = (q: any) => listTransactions({ ...q, type: undefined }, { type: 'repayment' });
