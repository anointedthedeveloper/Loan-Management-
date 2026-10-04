import { Types } from 'mongoose';
import { Customer } from '../models/Customer.js';
import { ensureSequenceAtLeast, nextSequence } from '../models/Counter.js';
import { CLIENT_ID_FLOOR } from '../config/customerOptions.js';
import { profileGaps } from './customerProfile.js';
import { ensureCustomerIndexes } from '../models/customerIndexes.js';
import { AppError } from '../utils/AppError.js';
import { changedFields } from '../utils/diff.js';
import { normalizePhone } from '../utils/phone.js';
import { skipOf } from '../utils/pagination.js';
import { AUDIT } from '../config/auditActions.js';
import { auditAs, listAudit } from './AuditService.js';
import { customerFinancials } from './customerFinancials.service.js';
import type { Actor } from '../types/index.js';
import type { CustomerInput, ListCustomersQuery } from '../validators/customers.js';

const ID_PREFIX = 'PTC-';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function nextCustomerId() {
  await ensureSequenceAtLeast('customer', CLIENT_ID_FLOOR); // new customers continue after the old loan book's client numbers (641, 642, ...)
  return `${ID_PREFIX}${String(await nextSequence('customer')).padStart(6, '0')}`;
}

const fullNameOf = (c: { firstName?: string; middleName?: string; lastName?: string }) =>
  [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ');

/** Plain object used for API output and audit snapshots. */
export function serialize(doc: any) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { __v, isArchived, archivedAt, archivedBy, ...rest } = o;
  const missing = profileGaps(o);
  return { ...rest, profileMissing: undefined, profile: { complete: missing.length === 0, missing }, id: String(o._id), _id: undefined, createdBy: nameRef(o.createdBy), updatedBy: nameRef(o.updatedBy) };
}
const nameRef = (u: any) => (u && typeof u === 'object' && 'name' in u ? { id: String(u._id), name: u.name } : u ? String(u) : null);

const FIELD_LABEL: Record<string, string> = { phone: 'phone number', email: 'email address', nin: 'NIN', bvn: 'BVN', idNumber: 'identification number', idType: 'identification number', ippisNumber: 'IPPIS number' };

async function assertNoDuplicate(c: { phone?: string; email?: string; nin?: string; bvn?: string; idType?: string; idNumber?: string; ippisNumber?: string }, excludeId?: Types.ObjectId) {
  const or: Record<string, unknown>[] = [];
  if (c.phone) or.push({ phone: c.phone });
  if (c.email) or.push({ email: c.email });
  if (c.idType && c.idNumber) or.push({ idType: c.idType, idNumber: c.idNumber });
  if (c.nin) or.push({ nin: c.nin });
  if (c.bvn) or.push({ bvn: c.bvn });
  if (c.ippisNumber) or.push({ 'employment.ippisNumber': c.ippisNumber });
  if (!or.length) return;
  const existing = await Customer.findOne({ isArchived: false, $or: or, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  if (!existing) return;
  const field = existing.phone === c.phone ? 'phone' : existing.email && existing.email === c.email ? 'email' : c.ippisNumber && existing.employment?.ippisNumber === c.ippisNumber ? 'ippisNumber' : c.nin && existing.nin === c.nin ? 'nin' : c.bvn && existing.bvn === c.bvn ? 'bvn' : 'idNumber';
  const errKey = field === 'ippisNumber' ? 'employment.ippisNumber' : field;
  throw new AppError(409, `A customer with this ${FIELD_LABEL[field]} already exists (${existing.customerId} – ${existing.fullName})`, 'DUPLICATE_CUSTOMER', { [errKey]: `Already registered to ${existing.customerId}` });
}

function mapDuplicateKey(err: any): never {
  if (err?.code === 11000) {
    const key = Object.keys(err.keyPattern ?? {})[0] ?? 'record';
    const field = key === 'idType' || key === 'idNumber' ? 'idNumber' : key === 'employment.ippisNumber' ? 'ippisNumber' : key;
    throw new AppError(409, `A customer with this ${FIELD_LABEL[field] ?? field} already exists`, 'DUPLICATE_CUSTOMER', { [field === 'ippisNumber' ? 'employment.ippisNumber' : field]: 'Already registered' });
  }
  throw err;
}

export async function createCustomer(input: CustomerInput, actor: Actor) {
  await ensureCustomerIndexes();
  const data = { ...input, fullName: fullNameOf(input) };
  await assertNoDuplicate({ ...data, ippisNumber: data.employment.ippisNumber });
  try {
    const customer = await Customer.create({ ...data, customerId: await nextCustomerId(), createdBy: actor.id, updatedBy: actor.id });
    const out = serialize(customer);
    await auditAs(actor, { action: AUDIT.CUSTOMER_CREATED, entity: 'Customer', entityId: out.id, entityLabel: customer.customerId, after: out });
    return out;
  } catch (e) { return mapDuplicateKey(e); }
}

async function findLive(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  const c = await Customer.findOne({ _id: id, isArchived: false });
  if (!c) throw AppError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  return c;
}

export async function getCustomer(id: string) {
  const c = await findLive(id);
  await c.populate([{ path: 'createdBy', select: 'name' }, { path: 'updatedBy', select: 'name' }]);
  return serialize(c);
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>, actor: Actor) {
  const c = await findLive(id);
  const before = serialize(c);
  const next = { ...input } as Record<string, any>;
  if ('firstName' in next || 'middleName' in next || 'lastName' in next) {
    next.fullName = fullNameOf({ firstName: next.firstName ?? c.firstName, middleName: 'middleName' in next ? next.middleName : c.middleName, lastName: next.lastName ?? c.lastName });
  }
  // Nested sections are merged so a partial edit can never drop a required value (e.g. IPPIS number).
  for (const k of ['employment', 'emergencyContact'] as const) {
    if (next[k]) next[k] = { ...((c.get(k) as { toObject?: () => object } | undefined)?.toObject?.() ?? c.get(k) ?? {}), ...next[k] };
  }
  const merged = { phone: next.phone ?? c.phone, email: 'email' in next ? next.email : c.email, nin: 'nin' in next ? next.nin : c.nin, bvn: 'bvn' in next ? next.bvn : c.bvn };
  const emp = (next.employment ?? (c.get('employment') as any)?.toObject?.() ?? {}) as { sector?: string; ippisNumber?: string; ministry?: string };
  if (next.employment) {
    const sector = emp.sector ?? (emp.ippisNumber ? 'government' : undefined); // profiles imported without a worker type can be completed bit by bit
    next.employment = { ...emp, ...(sector ? { sector } : {}) };
    const errs: Record<string, string> = {};
    if (sector === 'government') {
      if (!emp.ippisNumber) errs['employment.ippisNumber'] = 'Enter the IPPIS number (required for government workers)';
      if (!emp.ministry) errs['employment.ministry'] = 'Enter ministry / department';
    }
    if (Object.keys(errs).length) throw new AppError(422, 'Please correct the highlighted fields', 'VALIDATION_ERROR', errs);
  }
  await assertNoDuplicate({ ...merged, ippisNumber: emp.ippisNumber } as any, c._id);
  // Allow clearing optional fields: undefined from a blank form field means "unset".
  for (const [k, v] of Object.entries(next)) { if (v === undefined) c.set(k, undefined); else c.set(k, v); }
  c.updatedBy = new Types.ObjectId(actor.id);
  try { await c.save(); } catch (e) { mapDuplicateKey(e); }
  const after = serialize(c);

  const d = changedFields(before, after, ['updatedAt', 'updatedBy']);
  const { status: statusBefore, ...restBefore } = d.before as any;
  const { status: statusAfter, ...restAfter } = d.after as any;
  const entity = { entity: 'Customer', entityId: after.id, entityLabel: c.customerId };
  if (Object.keys(restAfter).length) await auditAs(actor, { ...entity, action: AUDIT.CUSTOMER_UPDATED, before: restBefore, after: restAfter });
  if (statusAfter !== undefined) await auditAs(actor, { ...entity, action: AUDIT.CUSTOMER_STATUS_CHANGED, before: { status: statusBefore }, after: { status: statusAfter } });
  return after;
}

/** Archives (soft-deletes). Refused outright when any financial history exists. */
export async function deleteCustomer(id: string, actor: Actor) {
  const c = await findLive(id);
  if (await customerFinancials().hasFinancialHistory(c._id)) {
    throw AppError.conflict(
      'This customer has loans, repayments or transactions on record and cannot be deleted, because financial history must remain auditable. Set the status to Inactive or Suspended instead.',
      'CUSTOMER_HAS_FINANCIAL_HISTORY',
    );
  }
  const before = serialize(c);
  c.isArchived = true; c.archivedAt = new Date(); c.archivedBy = new Types.ObjectId(actor.id); c.updatedBy = c.archivedBy;
  await c.save();
  await auditAs(actor, { action: AUDIT.CUSTOMER_DELETED, entity: 'Customer', entityId: before.id, entityLabel: c.customerId, before });
}

export async function listCustomers(q: ListCustomersQuery) {
  const filter: Record<string, any> = { isArchived: false };
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.profile === 'incomplete') filter['profileMissing.0'] = { $exists: true };
  if (q.profile === 'complete') filter.profileMissing = { $size: 0 };
  if (q.from || q.to) filter.registrationDate = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.q) {
    const term = escapeRe(q.q);
    const or: Record<string, unknown>[] = [{ customerId: new RegExp(term, 'i') }, { nin: new RegExp(term) }, { bvn: new RegExp(term) }, { fullName: new RegExp(term, 'i') }, { email: new RegExp(term, 'i') }, { 'employment.ippisNumber': new RegExp(term, 'i') }];
    const phone = normalizePhone(q.q);
    const digits = q.q.replace(/\D/g, '');
    if (phone) or.push({ phone }); else if (digits.length >= 3) or.push({ phone: new RegExp(escapeRe(digits.replace(/^(234)/, '0'))) });
    filter.$or = or;
  }
  const sort: Record<string, 1 | -1> = { [q.sort]: q.order === 'asc' ? 1 : -1, _id: -1 };
  const [rows, total] = await Promise.all([
    Customer.find(filter).sort(sort).collation({ locale: 'en', strength: 2 }).skip(skipOf(q)).limit(q.limit),
    Customer.countDocuments(filter),
  ]);
  return { items: rows.map(serialize), total };
}

export async function getCustomerSummary(id: string) {
  const c = await findLive(id);
  const metrics = await customerFinancials().getSummary(c._id);
  return metrics
    ? { customerId: c.customerId, available: true, metrics }
    : { customerId: c.customerId, available: false, metrics: null, message: 'No financial records yet. Figures appear here once loans and transactions are recorded.' };
}

type Kind = 'listLoans' | 'listRepayments' | 'listTransactions';
export async function getCustomerFinancialList(id: string, kind: Kind, q: { page: number; limit: number }) {
  const c = await findLive(id);
  return customerFinancials()[kind](c._id, skipOf(q), q.limit);
}

export async function getCustomerActivity(id: string, q: { page: number; limit: number }) {
  const c = await findLive(id);
  return listAudit({ entity: 'Customer', entityId: String(c._id) }, q);
}
