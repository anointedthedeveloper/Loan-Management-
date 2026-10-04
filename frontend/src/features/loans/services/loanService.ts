import { api, apiPage, qs } from '../../../services/api'
import type { Loan, LoanDetail, LoanPreview, Product, SettlementQuote, Transaction } from '../../../types/finance'

export const loanService = {
  list: (p: Record<string, string | number>) => apiPage<Loan>(`/loans${qs(p)}`),
  /** Fully repaid loans are kept on their own page. */
  listCompleted: (p: Record<string, string | number>) => apiPage<Loan>(`/loans${qs({ ...p, scope: 'completed' })}`),
  preview: (body: unknown) => api<LoanPreview>('/loans/preview', { method: 'POST', body }),
  create: (body: unknown) => api<LoanDetail>('/loans', { method: 'POST', body }),
  get: (id: string) => api<LoanDetail>(`/loans/${id}`),
  update: (id: string, body: unknown) => api<LoanDetail>(`/loans/${id}`, { method: 'PATCH', body }),
  action: (id: string, action: 'approve' | 'disburse' | 'reject' | 'cancel' | 'default' | 'recalculate', reason?: string) =>
    api<LoanDetail>(`/loans/${id}/${action}`, { method: 'POST', body: reason ? { reason } : undefined }),
  markInstallmentPaid: (id: string, number: number, body: unknown) => api<LoanDetail>(`/loans/${id}/installments/${number}/pay`, { method: 'POST', body }),
  settlementQuote: (id: string, date?: string) => api<{ quote: SettlementQuote }>(`/loans/${id}/settlement-quote${date ? `?date=${date}` : ''}`).then((r) => r.quote),
  settle: (id: string, body: unknown) => api<LoanDetail>(`/loans/${id}/settle`, { method: 'POST', body }),
  transactions: (id: string) => apiPage<Transaction>(`/loans/${id}/transactions`),
  products: () => api<{ products: Product[] }>('/loan-products').then((r) => r.products),
}
