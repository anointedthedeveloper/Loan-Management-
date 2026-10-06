import { Schema, model } from 'mongoose';

/**
 * A change an accountant may ask for but only the CEO can make: correcting or reversing a payment, changing a running loan,
 * deleting a customer. The CEO approves (the change is then carried out) or rejects it. Nothing changes until it is approved.
 */
const schema = new Schema(
  {
    requestId: { type: String, required: true, unique: true, immutable: true },
    kind: { type: String, enum: ['repayment_edit', 'transaction_reverse', 'loan_edit', 'customer_delete'], required: true, index: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    targetLabel: String, // e.g. TXN-000123, LN-000007, PTC-000201 Name
    loanRef: String,
    summary: String, // what is being asked, in words
    reason: String,
    payload: Schema.Types.Mixed,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    requestedByName: String,
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedByName: String,
    decidedAt: Date,
    decisionNote: String, // rejection reason, or what happened when it was carried out
  },
  { timestamps: true },
);
schema.index({ status: 1, createdAt: -1 });
export const ApprovalRequest = model('ApprovalRequest', schema);
