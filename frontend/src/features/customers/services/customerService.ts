import { api, apiPage, qs } from '../../../services/api'
import type { ActivityEntry } from '../../../types'
import type { Customer, CustomerListParams, CustomerMeta, CustomerSummary } from '../types'

export const customerService = {
  meta: () => api<CustomerMeta>('/customers/meta'),
  list: (p: CustomerListParams) => apiPage<Customer>(`/customers${qs({ ...p })}`),
  get: (id: string) => api<{ customer: Customer }>(`/customers/${id}`).then((r) => r.customer),
  create: (body: unknown) => api<{ customer: Customer }>('/customers', { method: 'POST', body }).then((r) => r.customer),
  update: (id: string, body: unknown) => api<{ customer: Customer }>(`/customers/${id}`, { method: 'PATCH', body }).then((r) => r.customer),
  remove: (id: string) => api<null>(`/customers/${id}`, { method: 'DELETE' }),
  summary: (id: string) => api<CustomerSummary>(`/customers/${id}/summary`),
  loans: (id: string) => apiPage<unknown>(`/customers/${id}/loans`),
  repayments: (id: string) => apiPage<unknown>(`/customers/${id}/repayments`),
  transactions: (id: string) => apiPage<unknown>(`/customers/${id}/transactions`),
  activity: (id: string) => apiPage<ActivityEntry>(`/customers/${id}/activity`),
}
