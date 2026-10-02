import { Types } from 'mongoose';
import { LoanProduct } from '../models/LoanProduct.js';
import { Loan } from '../models/Loan.js';
import { AppError } from '../utils/AppError.js';
import { changedFields } from '../utils/diff.js';
import { AUDIT } from '../config/auditActions.js';
import { auditAs } from './AuditService.js';
import type { Actor } from '../types/index.js';

export const serializeProduct = (p: any) => { const o = typeof p.toObject === 'function' ? p.toObject() : p; const { __v, ...r } = o; return { ...r, id: String(o._id), _id: undefined }; };

export async function listProducts(opts: { activeOnly?: boolean } = {}) {
  return (await LoanProduct.find(opts.activeOnly ? { isActive: true } : {}).sort({ isActive: -1, name: 1 })).map(serializeProduct);
}
export async function getProduct(id: string) {
  const p = Types.ObjectId.isValid(id) ? await LoanProduct.findById(id) : null;
  if (!p) throw AppError.notFound('Loan product not found', 'PRODUCT_NOT_FOUND');
  return p;
}
async function assertUniqueCode(code: string, excludeId?: unknown) {
  if (await LoanProduct.exists({ code, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) throw new AppError(409, 'A product with this code already exists', 'DUPLICATE_PRODUCT', { code: 'Already in use' });
}

export async function createProduct(input: any, actor: Actor) {
  await assertUniqueCode(input.code);
  const p = await LoanProduct.create({ ...input, createdBy: actor.id, updatedBy: actor.id });
  const out = serializeProduct(p);
  await auditAs(actor, { action: AUDIT.PRODUCT_CREATED, entity: 'LoanProduct', entityId: out.id, entityLabel: out.code, after: out });
  return out;
}
export async function updateProduct(id: string, input: any, actor: Actor) {
  const p = await getProduct(id);
  if (input.code && input.code !== p.code) await assertUniqueCode(input.code, p._id);
  const before = serializeProduct(p);
  // Pricing terms are copied onto each loan when it is created, so editing a product never rewrites existing loans.
  p.set({ ...input, updatedBy: actor.id });
  await p.save();
  const after = serializeProduct(p);
  const d = changedFields(before, after, ['updatedAt', 'updatedBy']);
  if (d.changed) await auditAs(actor, { action: AUDIT.PRODUCT_UPDATED, entity: 'LoanProduct', entityId: after.id, entityLabel: after.code, before: d.before, after: d.after });
  return after;
}
export async function deleteProduct(id: string, actor: Actor) {
  const p = await getProduct(id);
  if (await Loan.exists({ product: p._id })) throw AppError.conflict('Loans already use this product, so it cannot be deleted. Deactivate it instead.', 'PRODUCT_IN_USE');
  const before = serializeProduct(p);
  await p.deleteOne();
  await auditAs(actor, { action: AUDIT.PRODUCT_DELETED, entity: 'LoanProduct', entityId: before.id, entityLabel: before.code, before });
}
