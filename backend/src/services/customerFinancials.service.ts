import type { Types } from 'mongoose';

export interface PagedResult { items: unknown[]; total: number }
export interface CustomerFinancialSummary {
  totalBorrowed: number; totalRepaid: number; outstandingBalance: number;
  activeLoans: number; completedLoans: number; overdueLoans: number;
}

/**
 * Seam between the Customer module and the (future) loan / transaction modules.
 * Until those exist the default provider reports "no data" — nothing is fabricated.
 * Phases 3-5 call setCustomerFinancialProvider() with a real implementation.
 */
export interface CustomerFinancialProvider {
  hasFinancialHistory(customerId: Types.ObjectId): Promise<boolean>;
  getSummary(customerId: Types.ObjectId): Promise<CustomerFinancialSummary | null>;
  listLoans(customerId: Types.ObjectId, skip: number, limit: number): Promise<PagedResult>;
  listRepayments(customerId: Types.ObjectId, skip: number, limit: number): Promise<PagedResult>;
  listTransactions(customerId: Types.ObjectId, skip: number, limit: number): Promise<PagedResult>;
}

const empty: PagedResult = { items: [], total: 0 };
export const emptyProvider: CustomerFinancialProvider = {
  hasFinancialHistory: async () => false,
  getSummary: async () => null,
  listLoans: async () => empty,
  listRepayments: async () => empty,
  listTransactions: async () => empty,
};

let provider: CustomerFinancialProvider = emptyProvider;
export const setCustomerFinancialProvider = (p: CustomerFinancialProvider) => { provider = p; };
export const customerFinancials = () => provider;
