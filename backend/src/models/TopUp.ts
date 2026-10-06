import { Schema, model } from 'mongoose';

/** A top-up is its own record linked to the original loan; it never overwrites that loan. */
const schema = new Schema(
  {
    topUpId: { type: String, required: true, unique: true, immutable: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    loan: { type: Schema.Types.ObjectId, ref: 'Loan', required: true, index: true }, // existing loan
    resultingLoan: { type: Schema.Types.ObjectId, ref: 'Loan' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    requestedAmount: { type: Number, required: true }, // new funds
    duration: { value: Number, unit: String },
    frequency: String,
    customIntervalDays: Number,
    interestRate: Number,
    revisedTenor: Number, // months the old loan was used (liquidation formula)
    startDate: Date,
    /** Result of TopUpCalculationService at request time, and again (fresh) at approval time. */
    calculation: Schema.Types.Mixed,
    settlement: Schema.Types.Mixed, // what was settled / waived on the old loan at approval
    notes: String,
    statusReason: String,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }, approvedAt: Date,
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ createdAt: -1 });
export const TopUp = model('TopUp', schema);
