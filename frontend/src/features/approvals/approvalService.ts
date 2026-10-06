import { api, apiPage, qs } from '../../services/api'

export type ApprovalKind = 'repayment_edit' | 'transaction_reverse' | 'loan_edit' | 'customer_delete'
export interface ApprovalRequest {
  id: string; requestId: string; kind: ApprovalKind; targetLabel: string; loanRef?: string; summary: string; reason?: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; requestedByName: string; decidedByName?: string; decidedAt?: string; decisionNote?: string; createdAt: string
}
export const approvalService = {
  list: (p: Record<string, string | number>) => apiPage<ApprovalRequest>(`/approvals${qs(p)}`),
  request: (kind: ApprovalKind, targetId: string, reason: string, payload?: Record<string, unknown>) => api<{ request: ApprovalRequest }>('/approvals', { method: 'POST', body: { kind, targetId, reason, payload } }),
  approve: (id: string) => api<{ request: ApprovalRequest }>(`/approvals/${id}/approve`, { method: 'POST' }),
  reject: (id: string, reason: string) => api<{ request: ApprovalRequest }>(`/approvals/${id}/reject`, { method: 'POST', body: { reason } }),
  cancel: (id: string) => api<{ request: ApprovalRequest }>(`/approvals/${id}/cancel`, { method: 'POST' }),
}
