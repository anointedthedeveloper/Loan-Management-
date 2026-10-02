import { api, apiPage, qs } from '../../../services/api'
import type { LoanDetail, Transaction } from '../../../types/finance'

export const repaymentService = {
  list: (p: Record<string, string | number>) => apiPage<Transaction>(`/repayments${qs(p)}`),
  record: (body: unknown) => api<LoanDetail & { transaction: Transaction }>('/repayments', { method: 'POST', body }),
}
export const transactionService = {
  list: (p: Record<string, string | number>) => apiPage<Transaction>(`/transactions${qs(p)}`),
  create: (body: unknown) => api<{ transaction: Transaction }>('/transactions', { method: 'POST', body }),
  reverse: (id: string, reason: string) => api<{ transaction: Transaction }>(`/transactions/${id}/reverse`, { method: 'POST', body: { reason } }),
}
