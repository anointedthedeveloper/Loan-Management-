import { Types } from 'mongoose';
import { Attachment } from '../models/Attachment.js';
import { Transaction } from '../models/Transaction.js';
import { AppError } from '../utils/AppError.js';
import { AUDIT } from '../config/auditActions.js';
import { auditAs } from './AuditService.js';
import type { Actor } from '../types/index.js';

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // stays under the 4.5 MB serverless request limit
export const MAX_ATTACHMENTS_PER_PAYMENT = 5;

/** Accepted proof-of-payment types, by extension. The declared MIME type must agree. */
const TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], webp: ['image/webp'], gif: ['image/gif'],
  doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  txt: ['text/plain'],
};
export const ATTACHMENT_ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');

const meta = (a: any) => ({ id: String(a._id), filename: a.filename, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt, transaction: a.transaction ? String(a.transaction) : null });

export async function uploadAttachment(input: { filename: string; contentType: string; data: Buffer; loanId?: string; transactionId?: string }, actor: Actor) {
  const filename = input.filename.replace(/[\\/\r\n"]/g, '_').trim().slice(0, 150);
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  const allowed = TYPES[ext];
  if (!filename || !allowed) throw AppError.badRequest('Upload a PDF, image (PNG/JPG), Word or Excel file', 'ATTACHMENT_TYPE', { file: 'This file type is not allowed' });
  const mime = (input.contentType || '').split(';')[0]!.trim().toLowerCase();
  if (mime && mime !== 'application/octet-stream' && !allowed.includes(mime)) throw AppError.badRequest('The file content does not match its extension', 'ATTACHMENT_TYPE', { file: 'File type mismatch' });
  if (!Buffer.isBuffer(input.data) || !input.data.length) throw AppError.badRequest('The file is empty', 'ATTACHMENT_EMPTY', { file: 'The file is empty' });
  if (input.data.length > MAX_ATTACHMENT_BYTES) throw new AppError(413, 'The file is too large (maximum 4 MB)', 'ATTACHMENT_TOO_LARGE', { file: 'Maximum 4 MB' });

  let loan: Types.ObjectId | undefined; let transaction: Types.ObjectId | undefined;
  if (input.transactionId) {
    const tx = Types.ObjectId.isValid(input.transactionId) ? await Transaction.findById(input.transactionId).select('loan transactionId') : null;
    if (!tx) throw AppError.notFound('Transaction not found', 'TRANSACTION_NOT_FOUND');
    if (await Attachment.countDocuments({ transaction: tx._id }) >= MAX_ATTACHMENTS_PER_PAYMENT) throw AppError.badRequest(`A payment can have at most ${MAX_ATTACHMENTS_PER_PAYMENT} files`, 'ATTACHMENT_LIMIT');
    transaction = tx._id; loan = tx.loan ?? undefined;
  } else if (input.loanId && Types.ObjectId.isValid(input.loanId)) loan = new Types.ObjectId(input.loanId);

  const doc = await Attachment.create({ filename, mimeType: allowed[0], size: input.data.length, data: input.data, loan, transaction, uploadedBy: actor.id });
  if (transaction) await auditAs(actor, { action: AUDIT.ATTACHMENT_ADDED, entity: 'Transaction', entityId: String(transaction), after: { file: filename } });
  return meta(doc);
}

/** Links freshly uploaded files to the ledger entry that was just posted. */
export async function linkAttachments(ids: string[] | undefined, transactionId: Types.ObjectId, loanId: Types.ObjectId | undefined, actor: Actor) {
  if (!ids?.length) return;
  const valid = ids.filter((i) => Types.ObjectId.isValid(i));
  const r = await Attachment.updateMany({ _id: { $in: valid }, transaction: { $exists: false }, uploadedBy: actor.id }, { transaction: transactionId, ...(loanId ? { loan: loanId } : {}) });
  if (r.modifiedCount !== valid.length) throw AppError.badRequest('One of the uploaded files could not be attached. Upload it again.', 'ATTACHMENT_NOT_FOUND');
}

/** Attachment lists for many ledger rows in one query (no file bytes). */
export async function attachmentsFor(transactionIds: unknown[]): Promise<Map<string, ReturnType<typeof meta>[]>> {
  const out = new Map<string, ReturnType<typeof meta>[]>();
  if (!transactionIds.length) return out;
  const rows = await Attachment.find({ transaction: { $in: transactionIds as Types.ObjectId[] } }).select('-data').sort({ createdAt: 1 }).lean();
  for (const a of rows) { const k = String(a.transaction); out.set(k, [...(out.get(k) ?? []), meta(a)]); }
  return out;
}

export async function getAttachmentFile(id: string) {
  const a = Types.ObjectId.isValid(id) ? await Attachment.findById(id).select('+data') : null;
  if (!a) throw AppError.notFound('File not found', 'ATTACHMENT_NOT_FOUND');
  return a;
}

/** Only an upload that was never linked to a payment may be discarded; proof attached to the ledger stays. */
export async function discardAttachment(id: string, actor: Actor) {
  const r = await Attachment.deleteOne({ _id: id, transaction: { $exists: false }, uploadedBy: actor.id });
  if (!r.deletedCount) throw AppError.conflict('This file is attached to a payment and is kept for the record', 'ATTACHMENT_LOCKED');
}
