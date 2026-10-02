import { api, apiPage, qs } from '../../../services/api'
import type { Loan, LoanDetail, LoanPreview, Product, Transaction } from '../../../types/finance'

export const loanService = {
  list: (p: Record<string, string | number>) => apiPage<Loan>(`/loans${qs(p)}`),
  preview: (body: unknown) => api<LoanPreview>('/loans/preview', { method: 'POST', body }),
  create: (body: unknown) => api<LoanDetail>('/loans', { method: 'POST', body }),
  get: (id: string) => api<LoanDetail>(`/loans/${id}`),
  update: (id: string, body: unknown) => api<LoanDetail>(`/loans/${id}`, { method: 'PATCH', body }),
  action: (id: string, action: 'approve' | 'disburse' | 'reject' | 'cancel' | 'default' | 'recalculate', reason?: string) =>
    api<LoanDetail>(`/loans/${id}/${action}`, { method: 'POST', body: reason ? { reason } : undefined }),
  transactions: (id: string) => apiPage<Transaction>(`/loans/${id}/transactions`),
  products: () => api<{ products: Product[] }>('/loan-products').then((r) => r.products),
}
