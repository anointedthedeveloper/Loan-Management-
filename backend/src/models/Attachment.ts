import { Schema, model } from 'mongoose';

/**
 * Proof of payment (bank debit/credit alert, receipt, ...) kept with the ledger entry it supports.
 * The file lives in the database (serverless hosting has no durable disk) and is never edited or deleted once linked.
 */
const schema = new Schema(
  {
    filename: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    loan: { type: Schema.Types.ObjectId, ref: 'Loan', index: true },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const Attachment = model('Attachment', schema);
