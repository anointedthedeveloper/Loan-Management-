import { api } from '../../../services/api'
import type { Product } from '../../../types/finance'

export const settingsService = {
  all: () => api<{ settings: Record<string, Record<string, unknown>> }>('/settings').then((r) => r.settings),
  save: (section: string, value: unknown) => api<Record<string, unknown>>(`/settings/${section}`, { method: 'PUT', body: value }),
}
export const productService = {
  list: () => api<{ products: Product[] }>('/loan-products').then((r) => r.products),
  create: (body: unknown) => api<{ product: Product }>('/loan-products', { method: 'POST', body }),
  update: (id: string, body: unknown) => api<{ product: Product }>(`/loan-products/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => api<null>(`/loan-products/${id}`, { method: 'DELETE' }),
}
