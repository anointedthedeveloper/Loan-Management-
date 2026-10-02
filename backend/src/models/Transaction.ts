import { Schema, model } from 'mongoose';
import { TRANSACTION_TYPES, PAYMENT_METHODS } from '../config/loanOptions.js';

/**
 * Append-only financial ledger. Rows are never edited for amounts and never deleted:
 * a mistake is corrected by reversing (a new `reversal` row is written and the original is flagged).
 */
const schema = new Schema(
  {
    transactionId: { type: String, required: true, unique: true, immutable: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    loan: { type: Schema.Types.ObjectId, ref: 'Loan', index: true },
    topUp: { type: Schema.Types.ObjectId, ref: 'TopUp' },
    type: { type: String, enum: TRANSACTION_TYPES.map((t) => t.value), required: true },
    direction: { type: String, enum: ['in', 'out', 'none'], required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true },
    method: { type: String, enum: PAYMENT_METHODS.map((m) => m.value) },
    reference: { type: String, trim: true },
    description: { type: String, trim: true },
    /** False for non-cash entries (e.g. a balance settled by a top-up). Reports of cash collected ignore these. */
    isCash: { type: Boolean, default: true },
    /** True when the entry feeds the loan balance replay (repayments, top-up settlements). */
    affectsLoanBalance: { type: Boolean, default: false },
    allocations: [{ _id: false, number: Number, principal: Number, interest: Number }],
    reversalOf: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    reversedAt: Date,
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reversalReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ loan: 1, date: 1, createdAt: 1 });
schema.index({ customer: 1, date: -1 });
schema.index({ type: 1, date: -1 });
schema.index({ date: -1 });
schema.index({ loan: 1, reference: 1 }, { unique: true, partialFilterExpression: { reference: { $type: 'string' }, reversalOf: { $exists: false } }, name: 'uniq_loan_reference' });
export const Transaction = model('Transaction', schema);
