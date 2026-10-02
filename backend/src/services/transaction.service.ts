import { Types } from 'mongoose';
import { Transaction } from '../models/Transaction.js';
import { Loan } from '../models/Loan.js';
import { Customer } from '../models/Customer.js';
import { nextSequence } from '../models/Counter.js';
import { AppError } from '../utils/AppError.js';
import { skipOf } from '../utils/pagination.js';
import { todayLagos } from '../utils/dates.js';
import { AUDIT } from '../config/auditActions.js';
import { transactionType } from '../config/loanOptions.js';
import { auditAs } from './AuditService.js';
import { recalculateLoan } from './loanLedger.service.js';
import { getFinanceRules } from './settings.service.js';
import type { Actor } from '../types/index.js';

export const nextTransactionId = async () => `TXN-${String(await nextSequence('transaction')).padStart(6, '0')}`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface PostInput {
  customer: Types.ObjectId | string; loan?: Types.ObjectId | string; topUp?: Types.ObjectId | string;
  type: string; amount: number; date?: Date; method?: string; reference?: string; description?: string;
  isCash?: boolean; affectsLoanBalance?: boolean; createdBy?: string; reversalOf?: Types.ObjectId;
}

/** The single entry point for writing to the ledger. */
export async function postTransaction(i: PostInput) {
  const def = transactionType(i.type);
  if (!def) throw AppError.badRequest('Unknown transaction type', 'BAD_TRANSACTION_TYPE');
  const doc = new Transaction({
    transactionId: await nextTransactionId(), customer: i.customer, loan: i.loan, topUp: i.topUp, type: i.type, direction: def.direction,
    amount: i.amount, date: i.date ?? todayLagos(), method: i.method, reference: i.reference, description: i.description,
    isCash: i.isCash ?? true, affectsLoanBalance: i.affectsLoanBalance ?? false, createdBy: i.createdBy, reversalOf: i.reversalOf,
  } as any);
  await doc.save();
  return doc;
}

export function serializeTransaction(t: any) {
  const o = typeof t.toObject === 'function' ? t.toObject() : t;
  const ref = (x: any, f: (x: any) => object) => (x && typeof x === 'object' && x._id ? { id: String(x._id), ...f(x) } : x ? { id: String(x) } : null);
  return {
    id: String(o._id), transactionId: o.transactionId, type: o.type, direction: o.direction, amount: o.amount, date: o.date, method: o.method ?? null,
    reference: o.reference ?? null, description: o.description ?? null, isCash: o.isCash, affectsLoanBalance: o.affectsLoanBalance, allocations: o.allocations ?? [],
    customer: ref(o.customer, (c) => ({ customerId: c.customerId, fullName: c.fullName })),
    loan: ref(o.loan, (l) => ({ loanId: l.loanId })),
    createdBy: ref(o.createdBy, (u) => ({ name: u.name })), reversalOf: o.reversalOf ? String(o.reversalOf) : null,
    reversedAt: o.reversedAt ?? null, reversalReason: o.reversalReason ?? null, state: o.reversedAt ? 'reversed' : 'posted', createdAt: o.createdAt,
  };
}
const populateTx = [{ path: 'customer', select: 'customerId fullName' }, { path: 'loan', select: 'loanId' }, { path: 'createdBy', select: 'name' }];

export async function listTransactions(q: any, base: Record<string, unknown> = {}) {
  const f: Record<string, any> = { ...base };
  if (q.type) f.type = q.type;
  if (q.method) f.method = q.method;
  if (q.loan) f.loan = q.loan;
  if (q.customer) f.customer = q.customer;
  if (q.createdBy) f.createdBy = q.createdBy;
  if (q.state === 'reversed') f.reversedAt = { $exists: true };
  if (q.state === 'posted') f.reversedAt = { $exists: false };
  if (q.from || q.to) f.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.minAmount !== undefined || q.maxAmount !== undefined) f.amount = { ...(q.minAmount !== undefined && { $gte: q.minAmount }), ...(q.maxAmount !== undefined && { $lte: q.maxAmount }) };
  if (q.q) {
    const re = new RegExp(escapeRe(q.q), 'i');
    const cust = await Customer.find({ $or: [{ fullName: re }, { customerId: re }] }).select('_id').limit(200);
    f.$or = [{ transactionId: re }, { reference: re }, { customer: { $in: cust.map((c) => c._id) } }];
  }
  const sort: Record<string, 1 | -1> = { [q.sort]: q.order === 'asc' ? 1 : -1, _id: -1 };
  const [rows, total] = await Promise.all([
    Transaction.find(f).sort(sort).skip(skipOf(q)).limit(q.limit).populate(populateTx),
    Transaction.countDocuments(f),
  ]);
  return { items: rows.map(serializeTransaction), total };
}

export async function getTransaction(id: string) {
  const t = Types.ObjectId.isValid(id) ? await Transaction.findById(id).populate(populateTx) : null;
  if (!t) throw AppError.notFound('Transaction not found', 'TRANSACTION_NOT_FOUND');
  return serializeTransaction(t);
}

/** Fees, adjustments, refunds and other entries. They are recorded in the ledger but do not change loan balances until a rule for them is configured. */
export async function createManualTransaction(input: any, actor: Actor) {
  let customerId = input.customerId; let loanId = input.loanId;
  if (loanId) {
    const loan = await Loan.findById(loanId);
    if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
    customerId = String(loan.customer);
  }
  if (!(await Customer.exists({ _id: customerId }))) throw AppError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  await assertReference(input, loanId);
  const tx = await postTransaction({ ...input, customer: customerId, loan: loanId, createdBy: actor.id });
  await auditAs(actor, { action: AUDIT.TRANSACTION_CREATED, entity: 'Transaction', entityId: String(tx._id), entityLabel: tx.transactionId, after: { type: tx.type, amount: tx.amount, loan: loanId ?? null } });
  return getTransaction(String(tx._id));
}

export async function assertReference(input: { method?: string; reference?: string }, loanId?: string) {
  const rules = await getFinanceRules();
  if (input.method && rules.transactions.referenceRequiredFor.includes(input.method) && !input.reference)
    throw AppError.badRequest('Enter the payment reference for this payment method', 'VALIDATION_ERROR', { reference: 'Reference is required for this payment method' });
  if (input.reference && loanId && (await Transaction.exists({ loan: loanId, reference: input.reference, reversalOf: { $exists: false } })))
    throw new AppError(409, 'A transaction with this reference already exists on this loan', 'DUPLICATE_REFERENCE', { reference: 'Already recorded' });
}

/** Corrections are made by reversing, never by deleting or editing. */
export async function reverseTransaction(id: string, reason: string, actor: Actor) {
  const tx = Types.ObjectId.isValid(id) ? await Transaction.findById(id) : null;
  if (!tx) throw AppError.notFound('Transaction not found', 'TRANSACTION_NOT_FOUND');
  if (tx.reversedAt) throw AppError.conflict('This transaction has already been reversed', 'ALREADY_REVERSED');
  const def = transactionType(tx.type);
  if (!def?.reversible) throw AppError.badRequest(`${def?.label ?? 'This'} entries cannot be reversed. Cancel or adjust the loan instead.`, 'NOT_REVERSIBLE');
  tx.reversedAt = new Date(); tx.reversedBy = new Types.ObjectId(actor.id); tx.reversalReason = reason;
  await tx.save();
  const rev = await postTransaction({
    customer: tx.customer, loan: tx.loan ?? undefined, type: 'reversal', amount: tx.amount, description: `Reversal of ${tx.transactionId}: ${reason}`,
    isCash: tx.isCash, createdBy: actor.id, reversalOf: tx._id,
  });
  await Transaction.updateOne({ _id: rev._id }, { direction: tx.direction === 'in' ? 'out' : tx.direction === 'out' ? 'in' : 'none' });
  if (tx.affectsLoanBalance && tx.loan) await recalculateLoan(tx.loan);
  await auditAs(actor, { action: AUDIT.TRANSACTION_REVERSED, entity: 'Transaction', entityId: String(tx._id), entityLabel: tx.transactionId, after: { reason, reversal: rev.transactionId, amount: tx.amount, loan: tx.loan ? String(tx.loan) : null } });
  return getTransaction(String(tx._id));
}
