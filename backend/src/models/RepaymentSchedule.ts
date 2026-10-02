import { Schema, model } from 'mongoose';
import { INSTALLMENT_STATUSES } from '../config/loanOptions.js';

const installment = new Schema(
  {
    number: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    expectedAmount: { type: Number, required: true },
    principalComponent: { type: Number, required: true },
    interestComponent: { type: Number, required: true },
    paidPrincipal: { type: Number, default: 0 },
    paidInterest: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    remaining: { type: Number, required: true },
    status: { type: String, enum: INSTALLMENT_STATUSES, default: 'upcoming' },
  },
  { _id: false },
);

/** One document per loan. `expected*` fields are fixed at creation; `paid*`/`remaining`/`status` are replayed from the ledger. */
const schema = new Schema({ loan: { type: Schema.Types.ObjectId, ref: 'Loan', required: true, unique: true }, installments: [installment] }, { timestamps: true });
schema.index({ 'installments.dueDate': 1, 'installments.status': 1 });
export const RepaymentSchedule = model('RepaymentSchedule', schema);
