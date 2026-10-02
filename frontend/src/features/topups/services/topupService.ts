import { api, apiPage, qs } from '../../../services/api'
import type { TopUp, TopUpCalc } from '../../../types/finance'

export const topupService = {
  list: (p: Record<string, string | number>) => apiPage<TopUp>(`/topups${qs(p)}`),
  preview: (body: unknown) => api<{ calculation: TopUpCalc }>('/topups/preview', { method: 'POST', body }).then((r) => r.calculation),
  request: (body: unknown) => api<{ topUp: TopUp }>('/topups', { method: 'POST', body }).then((r) => r.topUp),
  action: (id: string, action: 'approve' | 'reject' | 'cancel', reason?: string) => api<{ topUp: TopUp }>(`/topups/${id}/${action}`, { method: 'POST', body: reason ? { reason } : {} }).then((r) => r.topUp),
}
