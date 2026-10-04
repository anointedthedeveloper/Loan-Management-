/**
 * Defaults for every configurable business rule. Stored overrides live in the SystemSetting
 * collection and are edited by the CEO in Settings. Nothing here is a final Protech rule:
 * values mirror the reference calculator (flat interest, equal installments) and are safe to change.
 */
export const DEFAULT_SETTINGS = {
  company: { name: 'Protech', address: '', phone: '', email: '', rcNumber: '', currency: 'NGN' },
  loans: {
    requireApproval: true,
    preventSelfApproval: false,
    autoDisburseOnApproval: true,
    maxActiveLoansPerCustomer: null as number | null,
    allowBackdatedStart: true,
  },
  repayment: {
    /** oldest_first: settle installments in due-date order. interest_first_overall: clear all interest, then principal. */
    allocationOrder: 'oldest_first' as 'oldest_first' | 'interest_first_overall',
    /** Inside one installment which component is paid first. */
    withinInstallment: 'interest_first' as 'interest_first' | 'principal_first' | 'proportional',
    /** reject: refuse payments above the balance. credit: accept and hold the excess as a customer credit on the loan. */
    overpaymentPolicy: 'reject' as 'reject' | 'credit',
    /** A payment may exceed what is owed by up to this many naira (e.g. 30,000 sent for 29,999.82) even when overpayments are otherwise rejected. */
    overpaymentTolerance: 1000,
    allowFutureDatedPayments: false,
    /** full_balance: an early settlement pays everything still owed. waive_future_interest: interest on installments not yet due is waived. */
    earlySettlement: 'full_balance' as 'full_balance' | 'waive_future_interest',
  },
  latePayment: {
    graceDays: 0,
    /** Penalty calculation is deliberately not implemented until Protech supplies the rule. */
    penalty: { type: 'none' as 'none' },
    defaultAfterDays: null as number | null,
  },
  topup: {
    requireApproval: true,
    /** consolidate: outstanding balance + new funds become one new loan. new_loan: separate loan for new funds only. */
    mode: 'consolidate' as 'consolidate' | 'new_loan',
    /** Which part of the existing balance is carried forward (the calculator's "Balance B/Fwd"). */
    balanceBasis: 'outstanding_total' as 'outstanding_total' | 'outstanding_principal',
    /** full_principal: interest on carried balance + new funds. new_funds_only: interest only on the new funds. */
    interestBasis: 'full_principal' as 'full_principal' | 'new_funds_only',
    /** Uses the previous loan's repayment history: minimum % of total repayment already paid. */
    minimumPercentRepaid: 0,
  },
  transactions: {
    referenceRequiredFor: ['bank_transfer', 'pos', 'cheque'] as string[],
  },
  preferences: { rowsPerPage: 15 },
};
export type Settings = typeof DEFAULT_SETTINGS;
export type SettingsSection = keyof Settings;
export const SETTINGS_SECTIONS = Object.keys(DEFAULT_SETTINGS) as SettingsSection[];
