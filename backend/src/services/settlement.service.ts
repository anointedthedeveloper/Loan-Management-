import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { AppError } from '../utils/AppError.js';
import { diffDays, todayLagos } from '../utils/dates.js';
import { fromKobo, toKobo } from '../utils/money.js';
import { AUDIT } from '../config/auditActions.js';
import { loanStatus } from '../config/loanOptions.js';
import { auditAs } from './AuditService.js';
import { getFinanceRules } from './settings.service.js';
import { recalculateLoan } from './loanLedger.service.js';
import { assertReference, postTransaction } from './transaction.service.js';
import { getLoan } from './loan.service.js';
import type { Actor } from '../types/index.js';

export interface SettlementQuote {
  loanId: string; date: Date; mode: 'full_balance' | 'waive_future_interest'
  outstandingBalance: number; interestWaived: number; amountToPay: number; installmentsRemaining: number
  waivers: { number: number; interest: number }[]
}

/**
 * What it costs to close a loan today. The rule is configuration (Settings > Repayment > Early settlement):
 * pay everything still owed, or pay it minus the interest on installments that are not yet due.
 */
export async function quoteSettlement(loanId: string, date: Date = todayLagos()): Promise<SettlementQuote> {
  const loan = await Loan.findById(loanId);
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  if (!loanStatus(loan.status)?.acceptsRepayments) throw AppError.badRequest(`A ${loan.status} loan cannot be settled`, 'SETTLEMENT_NOT_ALLOWED');
  const { state } = await recalculateLoan(loan._id);
  const rules = await getFinanceRules();
  const mode = rules.repayment.earlySettlement;
  const waivers = mode === 'waive_future_interest'
    ? state.installments.filter((i) => i.remaining > 0 && diffDays(i.dueDate, date) > 0).map((i) => ({ number: i.number, interest: fromKobo(Math.min(toKobo(i.interestComponent - i.paidInterest), toKobo(i.remaining))) })).filter((w) => w.interest > 0)
    : [];
  const waived = fromKobo(waivers.reduce((s, w) => s + toKobo(w.interest), 0));
  return {
    loanId: loan.loanId, date, mode, outstandingBalance: state.outstandingBalance, interestWaived: waived,
    amountToPay: fromKobo(toKobo(state.outstandingBalance) - toKobo(waived)), installmentsRemaining: state.installments.filter((i) => i.remaining > 0).length, waivers,
  };
}

/** Pays off a loan before its term ends. Waiving interest needs `canWaive` (loans.approve). */
export async function settleLoan(loanId: string, input: { date?: Date; method?: string; reference?: string; description?: string }, actor: Actor, canWaive: boolean) {
  const date = input.date ?? todayLagos();
  const rules = await getFinanceRules();
  if (!rules.repayment.allowFutureDatedPayments && diffDays(date, todayLagos()) > 0) throw AppError.badRequest('Settlement date cannot be in the future', 'VALIDATION_ERROR', { date: 'Cannot be in the future' });
  const quote = await quoteSettlement(loanId, date);
  if (quote.interestWaived > 0 && !canWaive) throw AppError.forbidden('Early settlement with waived interest needs approval rights', 'WAIVER_NOT_ALLOWED');
  const loan = (await Loan.findById(loanId))!;
  await assertReference(input, String(loan._id));

  if (quote.interestWaived > 0) {
    const w = await postTransaction({ customer: loan.customer, loan: loan._id, type: 'waiver', amount: quote.interestWaived, date, isCash: false, affectsLoanBalance: true,
      description: `Interest waived on early settlement of ${loan.loanId} (installments ${quote.waivers.map((x) => x.number).join(', ')})`, createdBy: actor.id });
    await Transaction.updateOne({ _id: w._id }, { fixedAllocations: quote.waivers.map((x) => ({ number: x.number, principal: 0, interest: x.interest })) });
  }
  if (quote.amountToPay > 0) {
    await postTransaction({ customer: loan.customer, loan: loan._id, type: 'repayment', amount: quote.amountToPay, date, method: input.method, reference: input.reference,
      description: input.description ?? `Early settlement of ${loan.loanId}`, affectsLoanBalance: true, createdBy: actor.id });
  }
  const { state, status } = await recalculateLoan(loan._id);
  if (!state.fullyPaid) throw AppError.badRequest('The loan could not be fully settled. Please check the ledger.', 'SETTLEMENT_INCOMPLETE');
  await auditAs(actor, { action: AUDIT.LOAN_SETTLED_EARLY, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId,
    before: { outstandingBalance: quote.outstandingBalance }, after: { paid: quote.amountToPay, interestWaived: quote.interestWaived, status, installmentsClosed: quote.installmentsRemaining } });
  return { quote, ...(await getLoan(String(loan._id))) };
}
