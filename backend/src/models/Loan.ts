import { Schema, model } from 'mongoose';
import { isLoanStatus, FREQUENCIES, DURATION_UNITS, RATE_BASES } from '../config/loanOptions.js';

const opt = (list: readonly { value: string }[]) => list.map((x) => x.value);
const money = { type: Number, default: 0 };

/**
 * Terms are fixed at creation. The "derived" block is *maintained* by BalanceService from the
 * transaction ledger (never edited by hand), so it can always be rebuilt from the ledger.
 */
const schema = new Schema(
  {
    loanId: { type: String, required: true, unique: true, immutable: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'LoanProduct' },
    productName: String,
    status: { type: String, default: 'pending', validate: { validator: isLoanStatus, message: 'Unknown loan status' } },

    // pricing inputs and results (see LoanCalculationService)
    amount: { type: Number, required: true }, // net amount the customer receives
    carriedBalance: money,
    bankDeductionRate: money,
    grossAmount: money,
    principal: { type: Number, required: true },
    interestType: { type: String, default: 'flat' },
    interestRate: { type: Number, required: true },
    rateBasis: { type: String, enum: opt(RATE_BASES), default: 'per_loan' },
    interestBasis: { type: String, default: 'full_principal' },
    interestAmount: { type: Number, required: true }, // one-time charge, fixed at the start: principal x rate x tenor
    monthlyInterest: money,                            // principal x rate for one month (shown for reference)
    totalRepayment: { type: Number, required: true },
    duration: { value: { type: Number, required: true }, unit: { type: String, enum: opt(DURATION_UNITS), required: true } },
    frequency: { type: String, enum: opt(FREQUENCIES), required: true },
    customIntervalDays: Number,
    numberOfInstallments: { type: Number, required: true },
    installmentAmount: { type: Number, required: true },
    startDate: { type: Date, required: true }, // payout / loan start
    firstPaymentDate: Date,                    // when the first installment falls due
    firstPaymentDateIsCustom: { type: Boolean, default: false },
    dueDate: { type: Date, required: true },
    /** new = first loan, renewal = customer has had a loan before, topup = created by a top-up (see the loan book's Status column). */
    loanType: { type: String, enum: ['new', 'renewal', 'topup'], default: 'new' },

    // derived from the ledger
    amountPaid: money, principalPaid: money, interestPaid: money,
    principalBalance: money, interestBalance: money, outstandingBalance: money, creditBalance: money,
    nextInstallmentNumber: Number, nextDueDate: Date, nextInstallmentAmount: money,
    daysOverdue: money, overdueAmount: money, nonCashCredits: money, lastRecalculatedAt: Date,

    // workflow
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }, approvedAt: Date,
    disbursedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' }, rejectedAt: Date, statusReason: String,
    topUpOf: { type: Schema.Types.ObjectId, ref: 'Loan' }, // set when created by a top-up
    topUp: { type: Schema.Types.ObjectId, ref: 'TopUp' },
    settledByTopUp: { type: Schema.Types.ObjectId, ref: 'TopUp' }, // set when closed by a consolidating top-up
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ status: 1, startDate: -1 });
schema.index({ status: 1, nextDueDate: 1 });
schema.index({ customer: 1, status: 1 });
schema.index({ createdAt: -1 });
export const Loan = model('Loan', schema);
