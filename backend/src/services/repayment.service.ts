import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { AppError } from '../utils/AppError.js';
import { todayLagos, diffDays } from '../utils/dates.js';
import { AUDIT } from '../config/auditActions.js';
import { loanStatus } from '../config/loanOptions.js';
import { auditAs } from './AuditService.js';
import { getFinanceRules } from './settings.service.js';
import { recalculateLoan } from './loanLedger.service.js';
import { assertReference, listTransactions, postTransaction, reverseTransaction, serializeTransaction, withAttachments } from './transaction.service.js';
import { Types } from 'mongoose';
import { linkAttachments } from './attachment.service.js';
import { getLoan } from './loan.service.js';
import { toKobo } from '../utils/money.js';
import type { Actor } from '../types/index.js';

/**
 * Records a repayment: validate -> ledger entry -> replay balances/schedule/status -> audit.
 * The loan's balances are never edited directly; they are rebuilt from the ledger.
 */
export async function recordRepayment(input: { loanId: string; amount: number; date?: Date; method?: string; reference?: string; description?: string; targetInstallment?: number; attachmentIds?: string[]; editedFrom?: Types.ObjectId }, actor: Actor) {
  const loan = await Loan.findById(input.loanId);
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  if (!loanStatus(loan.status)?.acceptsRepayments) throw AppError.badRequest(`Repayments cannot be recorded on a ${loan.status} loan`, 'REPAYMENT_NOT_ALLOWED');
  const rules = await getFinanceRules();
  const date = input.date ?? todayLagos();
  if (!rules.repayment.allowFutureDatedPayments && diffDays(date, todayLagos()) > 0) throw AppError.badRequest('Payment date cannot be in the future', 'VALIDATION_ERROR', { date: 'Cannot be in the future' });
  if (diffDays(date, loan.startDate) < -3650) throw AppError.badRequest('Payment date is unrealistic', 'VALIDATION_ERROR', { date: 'Check the date' });

  const { state: current } = await recalculateLoan(loan._id);
  if (toKobo(input.amount) > toKobo(current.outstandingBalance) + toKobo(rules.repayment.overpaymentTolerance ?? 1000) && rules.repayment.overpaymentPolicy === 'reject')
    throw AppError.badRequest(`Payment exceeds the outstanding balance of ₦${current.outstandingBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`, 'OVERPAYMENT', { amount: 'More than the outstanding balance' });
  await assertReference(input, String(loan._id));

  const tx = await postTransaction({ customer: loan.customer, loan: loan._id, type: 'repayment', amount: input.amount, date, method: input.method, reference: input.reference,
    description: input.description ?? `Repayment on ${loan.loanId}`, affectsLoanBalance: true, createdBy: actor.id });
  if (input.targetInstallment || input.editedFrom) await Transaction.updateOne({ _id: tx._id }, { ...(input.targetInstallment ? { targetInstallment: input.targetInstallment } : {}), ...(input.editedFrom ? { editedFrom: input.editedFrom } : {}) });
  await linkAttachments(input.attachmentIds, tx._id, loan._id, actor);
  const { state, status } = await recalculateLoan(loan._id);
  await auditAs(actor, { action: AUDIT.REPAYMENT_RECORDED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId,
    before: { outstandingBalance: current.outstandingBalance, status: loan.status },
    after: { transaction: tx.transactionId, amount: input.amount, outstandingBalance: state.outstandingBalance, status } });
  const fresh = await Transaction.findById(tx._id).populate([{ path: 'customer', select: 'customerId fullName' }, { path: 'loan', select: 'loanId' }, { path: 'createdBy', select: 'name' }]);
  return { transaction: (await withAttachments([serializeTransaction(fresh)]))[0], ...(await getLoan(String(loan._id))) };
}

/** "Mark this month paid": records a repayment for exactly what is still owed on one installment. */
export async function markInstallmentPaid(loanId: string, number: number, input: { amount?: number; date?: Date; method?: string; reference?: string; description?: string; attachmentIds?: string[] }, actor: Actor) {
  const loan = await Loan.findById(loanId);
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  const { state } = await recalculateLoan(loan._id);
  const inst = state.installments.find((i) => i.number === number);
  if (!inst) throw AppError.notFound(`Installment ${number} does not exist on this loan`, 'INSTALLMENT_NOT_FOUND');
  if (inst.remaining <= 0) throw AppError.conflict(`Installment ${number} is already fully paid`, 'ALREADY_PAID');
  const amount = input.amount ?? inst.remaining; // editable: the user may record what was actually paid
  const r = await recordRepayment({ loanId, amount, targetInstallment: number, description: input.description ?? `Installment ${number} of ${loan.numberOfInstallments} ${amount < inst.remaining ? 'part-paid' : 'paid'}`, date: input.date, method: input.method, reference: input.reference, attachmentIds: input.attachmentIds }, actor);
  await auditAs(actor, { action: AUDIT.INSTALLMENT_MARKED_PAID, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId, after: { installment: number, amount, owed: inst.remaining } });
  return r;
}

export const listRepayments = (q: any) => listTransactions({ ...q, type: undefined }, { type: 'repayment' });


/**
 * Edits a recorded repayment (amount, date, method, reference, note). The ledger is append-only, so the original is
 * reversed and a replacement is posted; both stay visible, linked, and audited with the reason. Proof files move to the replacement.
 */
export async function editRepayment(id: string, input: { amount: number; date?: Date; method?: string; reference?: string; description?: string; reason: string; attachmentIds?: string[] }, actor: Actor) {
  const orig = Types.ObjectId.isValid(id) ? await Transaction.findById(id) : null;
  if (!orig || orig.type !== 'repayment' || !orig.loan) throw AppError.notFound('Repayment not found', 'TRANSACTION_NOT_FOUND');
  if (orig.reversedAt) throw AppError.conflict('This repayment was already reversed or replaced', 'ALREADY_REVERSED');
  if ((orig.fixedAllocations?.length ?? 0) > 0) throw AppError.badRequest('This entry is part of an early settlement and cannot be edited. Reverse it instead.', 'NOT_EDITABLE');
  const loan = await Loan.findById(orig.loan);
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  const rules = await getFinanceRules();
  const date = input.date ?? orig.date;
  if (!rules.repayment.allowFutureDatedPayments && diffDays(date, todayLagos()) > 0) throw AppError.badRequest('Payment date cannot be in the future', 'VALIDATION_ERROR', { date: 'Cannot be in the future' });
  const { state } = await recalculateLoan(loan._id);
  if (toKobo(input.amount) > toKobo(state.outstandingBalance) + toKobo(orig.amount) + toKobo(rules.repayment.overpaymentTolerance ?? 1000) && rules.repayment.overpaymentPolicy === 'reject')
    throw AppError.badRequest('The new amount is more than the loan still owes', 'OVERPAYMENT', { amount: 'More than the outstanding balance' });
  const method = input.method ?? orig.method ?? undefined;
  const reference = input.reference ?? orig.reference ?? undefined;

  await reverseTransaction(id, `Edited: ${input.reason}`, actor);
  // The replaced entry gives up its reference so the corrected one can reuse it.
  if (orig.reference) await Transaction.updateOne({ _id: orig._id }, { $unset: { reference: 1 }, supersededReference: orig.reference });
  const r = await recordRepayment({ loanId: String(loan._id), amount: input.amount, date, method, reference,
    description: input.description ?? orig.description ?? undefined, targetInstallment: orig.targetInstallment ?? undefined, editedFrom: orig._id }, actor);
  const newId = new Types.ObjectId(r.transaction!.id);
  await Transaction.updateOne({ _id: orig._id }, { supersededBy: newId });
  const { Attachment } = await import('../models/Attachment.js');
  await Attachment.updateMany({ transaction: orig._id }, { transaction: newId });
  await linkAttachments(input.attachmentIds, newId, loan._id, actor);
  await auditAs(actor, { action: AUDIT.REPAYMENT_EDITED, entity: 'Loan', entityId: String(loan._id), entityLabel: loan.loanId,
    before: { transaction: orig.transactionId, amount: orig.amount, date: orig.date, method: orig.method ?? null, reference: orig.reference ?? null },
    after: { transaction: r.transaction!.transactionId, amount: input.amount, date, method: method ?? null, reference: reference ?? null, reason: input.reason } });
  return { ...r, transaction: (await withAttachments([r.transaction!]))[0] };
}
