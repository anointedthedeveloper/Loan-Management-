import { Schema, model } from 'mongoose';
import { FREQUENCIES, DURATION_UNITS, RATE_BASES } from '../config/loanOptions.js';

const opt = (list: readonly { value: string }[]) => list.map((x) => x.value);

const schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true, default: 'General' }, // e.g. Salary advance, SME / Business, Daily trader
    interestType: { type: String, enum: ['flat'], default: 'flat' }, // extend when other interest types are introduced
    interestRate: { type: Number, required: true, min: 0 },
    rateBasis: { type: String, enum: opt(RATE_BASES), default: 'per_loan' },
    bankDeductionRate: { type: Number, default: 0, min: 0, max: 99 },
    minAmount: { type: Number, default: 0, min: 0 },
    maxAmount: { type: Number, min: 0 },
    minDuration: { type: Number, default: 1, min: 1 },
    maxDuration: { type: Number, min: 1 },
    durationUnit: { type: String, enum: opt(DURATION_UNITS), default: 'months' },
    allowedFrequencies: { type: [String], enum: opt(FREQUENCIES), default: ['monthly'] },
    defaultFrequency: { type: String, enum: opt(FREQUENCIES), default: 'monthly' },
    /** True once the product has been moved to the one-time flat interest rule (see product.service). */
    oneTimeApplied: { type: Boolean },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ isActive: 1, category: 1, name: 1 });
export const LoanProduct = model('LoanProduct', schema);
