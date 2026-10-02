import type { Option, Tone } from './index'

export interface LoanStatusOption { value: string; label: string; tone: Tone; manual: boolean; acceptsRepayments: boolean }
export interface LoanMeta {
  statuses: LoanStatusOption[]; frequencies: Option[]; durationUnits: Option[]; rateBases: Option[]; paymentMethods: Option[]
  transactionTypes: (Option & { direction: string; manual: boolean; reversible: boolean })[]
}

export interface CustomerRef { id: string; customerId?: string; fullName?: string; phone?: string }
export interface Installment {
  number: number; dueDate: string; expectedAmount: number; principalComponent: number; interestComponent: number
  paidPrincipal: number; paidInterest: number; amountPaid: number; remaining: number; status: string
}
export interface Terms {
  amount: number; carriedBalance: number; bankDeductionRate: number; grossAmount: number; principal: number; interestBase: number
  interestAmount: number; totalRepayment: number; numberOfInstallments: number; installmentAmount: number; finalInstallmentAmount: number
  durationMonths: number; startDate: string; dueDate: string
}
export interface Loan {
  id: string; loanId: string; status: string; customer: CustomerRef; productName?: string; product: string | null
  amount: number; carriedBalance: number; bankDeductionRate: number; grossAmount: number; principal: number
  interestRate: number; rateBasis: string; interestAmount: number; totalRepayment: number
  duration: { value: number; unit: string }; frequency: string; customIntervalDays?: number; numberOfInstallments: number; installmentAmount: number
  startDate: string; firstPaymentDate?: string | null; firstPaymentDateIsCustom?: boolean; dueDate: string; loanType?: 'new' | 'renewal' | 'topup'
  amountPaid: number; principalPaid: number; interestPaid: number; principalBalance: number; interestBalance: number; outstandingBalance: number; creditBalance: number
  nextInstallmentNumber?: number | null; nextDueDate?: string | null; nextInstallmentAmount: number; daysOverdue: number; overdueAmount: number
  notes?: string; statusReason?: string; createdBy?: { id: string; name?: string } | null; approvedBy?: { id: string; name?: string } | null
  topUpOf?: string | null; topUp?: string | null; settledByTopUp?: string | null; createdAt: string
}
export interface LoanDetail { loan: Loan; schedule: Installment[] }
export interface LoanPreview {
  product: { id: string; name: string; code: string; interestRate: number; rateBasis: string; bankDeductionRate: number }
  frequency: string; duration: { value: number; unit: string }; terms: Terms; schedule: Installment[]
}

export interface Product {
  id: string; name: string; code: string; description?: string; interestRate: number; rateBasis: string; bankDeductionRate: number
  minAmount: number; maxAmount?: number; minDuration: number; maxDuration?: number; durationUnit: string
  allowedFrequencies: string[]; defaultFrequency: string; isActive: boolean; category?: string
}

export interface Transaction {
  id: string; transactionId: string; type: string; direction: string; amount: number; date: string; method: string | null; reference: string | null
  description: string | null; isCash: boolean; affectsLoanBalance: boolean; allocations: { number: number; principal: number; interest: number }[]
  customer: CustomerRef | null; loan: { id: string; loanId?: string } | null; createdBy: { id: string; name?: string } | null
  reversalOf: string | null; reversedAt: string | null; reversalReason: string | null; state: 'posted' | 'reversed'; createdAt: string
}

export interface TopUpCalc {
  mode: string; carriedBalance: number; newFunds: number; percentRepaid: number; eligible: boolean; ineligibleReason?: string
  terms: Terms; existingLoan: string; existingOutstanding: number; settledOnExistingLoan: number; waivedOnExistingLoan: number
}
export interface TopUp {
  id: string; topUpId: string; status: string; requestedAmount: number; duration: { value: number; unit: string }; frequency: string; interestRate: number
  startDate: string; calculation: TopUpCalc; settlement: { settled: number; carriedForward: number; waived: number; intoLoan: string } | null
  notes: string | null; statusReason: string | null; customer: CustomerRef | null; loan: { id: string; loanId?: string } | null
  resultingLoan: { id: string; loanId?: string } | null; requestedBy: { name?: string } | null; approvedBy: { name?: string } | null; approvedAt: string | null; createdAt: string
}
