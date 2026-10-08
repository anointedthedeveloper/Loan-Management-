import { Types } from 'mongoose';
import { ApprovalRequest } from '../models/ApprovalRequest.js';
import { Transaction } from '../models/Transaction.js';
import { Loan } from '../models/Loan.js';
import { Customer } from '../models/Customer.js';
import { nextSequence } from '../models/Counter.js';
import { AppError } from '../utils/AppError.js';
import { skipOf } from '../utils/pagination.js';
import { AUDIT } from '../config/auditActions.js';
import { auditAs } from './AuditService.js';
import { editRepayment } from './repayment.service.js';
import { reverseTransaction } from './transaction.service.js';
import { updateLoan } from './loan.service.js';
import { terminateLoan, quoteTermination } from './settlement.service.js';
import { deleteCustomer } from './customer.service.js';
import type { Actor } from '../types/index.js';

export type ApprovalKind = 'repayment_edit' | 'transaction_reverse' | 'loan_edit' | 'loan_terminate' | 'customer_delete';
const nextId = async () => `REQ-${String(await nextSequence('approval')).padStart(6, '0')}`;
const naira = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const serializeRequest = (r: any) => {
  const o = typeof r.toObject === 'function' ? r.toObject() : r; const { __v, _id, ...rest } = o;
  return { ...rest, id: String(_id), targetId: String(o.targetId), requestedBy: o.requestedBy ? String(o.requestedBy) : null, decidedBy: o.decidedBy ? String(o.decidedBy) : null };
};

/** Records a request. The payload is exactly what will be applied on approval (already validated by the route). */
export async function createRequest(kind: ApprovalKind, targetId: string, payload: any, reason: string | undefined, actor: Actor) {
  if (!Types.ObjectId.isValid(targetId)) throw AppError.notFound('Nothing to change was found', 'NOT_FOUND');
  let targetLabel = ''; let loanRef: string | undefined; let summary = '';
  if (kind === 'repayment_edit' || kind === 'transaction_reverse') {
    const tx = await Transaction.findById(targetId).populate('loan', 'loanId');
    if (!tx) throw AppError.notFound('Transaction not found', 'TRANSACTION_NOT_FOUND');
    if (tx.reversedAt) throw AppError.conflict('This transaction was already reversed or replaced', 'ALREADY_REVERSED');
    if (kind === 'repayment_edit' && tx.type !== 'repayment') throw AppError.badRequest('Only repayments can be corrected', 'NOT_EDITABLE');
    targetLabel = tx.transactionId; loanRef = (tx.loan as any)?.loanId;
    summary = kind === 'repayment_edit' ? `Change ${tx.transactionId} (${naira(tx.amount)}) to ${naira(payload.amount)}${payload.date ? ` dated ${new Date(payload.date).toISOString().slice(0, 10)}` : ''}` : `Reverse ${tx.transactionId} (${naira(tx.amount)})`;
  } else if (kind === 'loan_terminate') {
    const loan = await Loan.findById(targetId);
    if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
    const q = await quoteTermination(targetId, payload.date ? new Date(payload.date) : undefined);
    targetLabel = loan.loanId; loanRef = loan.loanId;
    summary = `Terminate ${loan.loanId} early: pay ${naira(q.outstanding)} + ${q.feeRate}% fee ${naira(q.fee)} = ${naira(q.amountToPay)} (${naira(q.interestWaived)} interest not charged)`;
  } else if (kind === 'loan_edit') {
    const loan = await Loan.findById(targetId);
    if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
    targetLabel = loan.loanId; loanRef = loan.loanId;
    const bits = [payload.amount !== undefined && `amount ${naira(payload.amount)}`, payload.duration && `duration ${payload.duration.value} ${payload.duration.unit}`, payload.startDate && 'start date', payload.interestRate !== undefined && `rate ${payload.interestRate}%`, payload.rateBasis && 'interest rule'].filter(Boolean);
    summary = `Change ${loan.loanId}: ${bits.join(', ') || 'terms'}`;
  } else {
    const c = await Customer.findOne({ _id: targetId, isArchived: false });
    if (!c) throw AppError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
    targetLabel = `${c.customerId} ${c.fullName}`; summary = `Delete customer ${c.fullName} (${c.customerId})`;
  }
  if (await ApprovalRequest.exists({ kind, targetId, status: 'pending' })) throw AppError.conflict('There is already a request waiting for approval for this', 'REQUEST_PENDING_EXISTS');
  const r = await ApprovalRequest.create({ requestId: await nextId(), kind, targetId, targetLabel, loanRef, summary, reason, payload, requestedBy: actor.id, requestedByName: actor.name });
  await auditAs(actor, { action: AUDIT.CHANGE_REQUESTED, entity: 'ApprovalRequest', entityId: String(r._id), entityLabel: r.requestId, after: { kind, target: targetLabel, summary, reason: reason ?? null } });
  return serializeRequest(r);
}

export async function listRequests(q: { status?: string; mine?: string; page: number; limit: number }) {
  const f: Record<string, any> = {};
  if (q.status) f.status = q.status; if (q.mine) f.requestedBy = q.mine;
  const [rows, total] = await Promise.all([ApprovalRequest.find(f).sort({ status: 1, createdAt: -1 }).skip(skipOf(q)).limit(q.limit), ApprovalRequest.countDocuments(f)]);
  return { items: rows.map(serializeRequest), total };
}
export const pendingCount = () => ApprovalRequest.countDocuments({ status: 'pending' });

async function find(id: string) {
  const r = Types.ObjectId.isValid(id) ? await ApprovalRequest.findById(id) : null;
  if (!r) throw AppError.notFound('Request not found', 'REQUEST_NOT_FOUND');
  return r;
}

/** Carries out the change as the approver. If it can no longer be applied (e.g. the loan changed) the request stays pending and the reason is returned. */
export async function approveRequest(id: string, actor: Actor) {
  const r = await find(id);
  if (r.status !== 'pending') throw AppError.conflict(`This request is already ${r.status}`, 'INVALID_REQUEST_STATE');
  const p: any = r.payload ?? {};
  const target = String(r.targetId);
  if (r.kind === 'repayment_edit') await editRepayment(target, { ...p, date: p.date ? new Date(p.date) : undefined, reason: p.reason ?? r.reason ?? `Requested by ${r.requestedByName}` }, actor);
  else if (r.kind === 'transaction_reverse') await reverseTransaction(target, p.reason ?? r.reason ?? 'Approved request', actor);
  else if (r.kind === 'loan_terminate') await terminateLoan(target, { date: p.date ? new Date(p.date) : undefined, method: p.method, reference: p.reference, description: p.description }, actor);
  else if (r.kind === 'loan_edit') await updateLoan(target, { ...p, startDate: p.startDate ? new Date(p.startDate) : undefined, firstPaymentDate: p.firstPaymentDate ? new Date(p.firstPaymentDate) : undefined, reason: p.reason ?? r.reason }, actor, true);
  else await deleteCustomer(target, actor);
  r.status = 'approved'; r.decidedBy = new Types.ObjectId(actor.id); r.decidedByName = actor.name; r.decidedAt = new Date(); r.decisionNote = 'Carried out';
  await r.save();
  await auditAs(actor, { action: AUDIT.CHANGE_APPROVED, entity: 'ApprovalRequest', entityId: String(r._id), entityLabel: r.requestId, after: { kind: r.kind, target: r.targetLabel, requestedBy: r.requestedByName } });
  return serializeRequest(r);
}

async function close(id: string, actor: Actor, to: 'rejected' | 'cancelled', note?: string) {
  const r = await find(id);
  if (r.status !== 'pending') throw AppError.conflict(`This request is already ${r.status}`, 'INVALID_REQUEST_STATE');
  r.status = to; r.decidedBy = new Types.ObjectId(actor.id); r.decidedByName = actor.name; r.decidedAt = new Date(); r.decisionNote = note;
  await r.save();
  if (to === 'rejected') await auditAs(actor, { action: AUDIT.CHANGE_REJECTED, entity: 'ApprovalRequest', entityId: String(r._id), entityLabel: r.requestId, after: { kind: r.kind, target: r.targetLabel, reason: note ?? null } });
  return serializeRequest(r);
}
export const rejectRequest = (id: string, note: string, actor: Actor) => close(id, actor, 'rejected', note);
export async function cancelRequest(id: string, actor: Actor, canDecide: boolean) {
  const r = await find(id);
  if (!canDecide && String(r.requestedBy) !== actor.id) throw AppError.forbidden('You can only cancel your own requests');
  return close(id, actor, 'cancelled', 'Cancelled by the requester');
}
