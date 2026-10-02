import type { Option } from '../../types'

/**
 * Describes each configurable section so the settings screen is generated, not hand-built.
 * Keys and allowed values mirror backend/src/config/defaultSettings.ts and validators/settings.ts;
 * to add a setting: add it there, then add one entry here.
 */
export type SettingField =
  | { key: string; label: string; type: 'text' | 'number'; help?: string; nullable?: boolean }
  | { key: string; label: string; type: 'toggle'; help?: string }
  | { key: string; label: string; type: 'select'; options: Option[]; help?: string }
  | { key: string; label: string; type: 'multi'; options: Option[]; help?: string }

export interface SettingSection { key: string; label: string; description: string; fields: SettingField[] }

const methods: Option[] = [{ value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'pos', label: 'POS' }, { value: 'cheque', label: 'Cheque' }, { value: 'mobile_money', label: 'Mobile money' }, { value: 'other', label: 'Other' }]

export const SETTING_SECTIONS: SettingSection[] = [
  { key: 'company', label: 'Company', description: 'Shown on reports and exports.', fields: [
    { key: 'name', label: 'Company name', type: 'text' }, { key: 'rcNumber', label: 'RC number', type: 'text' }, { key: 'address', label: 'Address', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'currency', label: 'Currency code', type: 'text' } ] },
  { key: 'loans', label: 'Loan rules', description: 'Approval workflow and eligibility.', fields: [
    { key: 'requireApproval', label: 'Require approval before disbursement', type: 'toggle', help: 'When off, new loans are approved and disbursed immediately.' },
    { key: 'preventSelfApproval', label: 'Block approving your own loans', type: 'toggle' },
    { key: 'autoDisburseOnApproval', label: 'Disburse automatically on approval', type: 'toggle', help: 'When off, approval and disbursement are separate steps.' },
    { key: 'maxActiveLoansPerCustomer', label: 'Maximum open loans per customer', type: 'number', nullable: true, help: 'Leave empty for no limit.' },
    { key: 'allowBackdatedStart', label: 'Allow loan start dates in the past', type: 'toggle' } ] },
  { key: 'repayment', label: 'Repayment rules', description: 'How a payment is applied to a loan.', fields: [
    { key: 'allocationOrder', label: 'Allocation order', type: 'select', options: [{ value: 'oldest_first', label: 'Oldest installment first' }, { value: 'interest_first_overall', label: 'All interest first, then principal' }] },
    { key: 'withinInstallment', label: 'Inside an installment', type: 'select', options: [{ value: 'interest_first', label: 'Interest first' }, { value: 'principal_first', label: 'Principal first' }, { value: 'proportional', label: 'Proportionally' }] },
    { key: 'overpaymentPolicy', label: 'Payment above the balance', type: 'select', options: [{ value: 'reject', label: 'Reject the payment' }, { value: 'credit', label: 'Accept and hold the excess as credit' }] },
    { key: 'allowFutureDatedPayments', label: 'Allow future-dated payments', type: 'toggle' },
    { key: 'earlySettlement', label: 'Early settlement (paying a loan off before its term ends)', type: 'select', options: [{ value: 'full_balance', label: 'Pay everything still owed' }, { value: 'waive_future_interest', label: 'Waive interest on installments not yet due' }], help: 'Waiving interest can only be done by someone with loan approval rights.' } ] },
  { key: 'latePayment', label: 'Late payment', description: 'Overdue and default timing. Penalty calculation is not enabled until Protech’s rule is configured.', fields: [
    { key: 'graceDays', label: 'Grace days before an installment is overdue', type: 'number' },
    { key: 'defaultAfterDays', label: 'Mark as defaulted after (days overdue)', type: 'number', nullable: true, help: 'Leave empty to default loans manually only.' } ] },
  { key: 'topup', label: 'Top-up rules', description: 'How a top-up is priced and settled.', fields: [
    { key: 'requireApproval', label: 'Require approval', type: 'toggle' },
    { key: 'mode', label: 'Top-up mode', type: 'select', options: [{ value: 'consolidate', label: 'Consolidate balance + new funds into a new loan' }, { value: 'new_loan', label: 'Create a separate loan for the new funds' }] },
    { key: 'balanceBasis', label: 'Balance carried forward', type: 'select', options: [{ value: 'outstanding_total', label: 'Total outstanding (principal + interest)' }, { value: 'outstanding_principal', label: 'Outstanding principal only' }] },
    { key: 'interestBasis', label: 'Interest charged on', type: 'select', options: [{ value: 'full_principal', label: 'Carried balance + new funds' }, { value: 'new_funds_only', label: 'New funds only' }] },
    { key: 'minimumPercentRepaid', label: 'Minimum % of existing loan repaid', type: 'number', help: 'Uses the previous loan’s repayment history for eligibility.' } ] },
  { key: 'transactions', label: 'Transactions', description: 'Ledger entry requirements.', fields: [
    { key: 'referenceRequiredFor', label: 'Payment methods that require a reference', type: 'multi', options: methods } ] },
  { key: 'preferences', label: 'Preferences', description: 'System display preferences.', fields: [{ key: 'rowsPerPage', label: 'Default rows per page', type: 'number' }] },
]
