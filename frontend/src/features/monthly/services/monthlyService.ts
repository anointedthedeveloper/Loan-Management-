import { api, download, uploadFile } from '../../../services/api'

export type RowAction = 'new-loan' | 'top-up' | 'update-loan' | 'update-customer' | 'unchanged' | 'error'
export interface PlanRow {
  row: number; name: string; clientId: string | null; ippis: string; type: 'NEW' | 'TOP UP' | 'RENEWAL' | null; action: RowAction
  customerRef?: string; matchedName?: string; topUpOfRef?: string; loanRef?: string
  customerChanges: string[]; loanChanges: string[]
  tenor?: number; bank?: number; carried?: number; principal?: number; interest?: number; total?: number; emi?: number
  errors: string[]; warnings: string[]
}
export interface Plan { rows: PlanRow[]; counts: { newLoans: number; loanUpdates: number; customerUpdates: number; unchanged: number; errors: number }; needsApproval: boolean; product: string }
export interface ResultRow { row: number; name: string; clientId: string; ippis: string; kind: string; status: 'pending' | 'active' | 'updated' | 'unchanged' | 'skipped'; loan?: string; loanRef?: string; messages: string[] }
export interface UploadResult { id: string; filename: string; total: number; created: number; updated: number; unchanged: number; skipped: number; needsApproval: boolean; rows: ResultRow[] }
export interface UploadHistory { id: string; filename: string; uploadedBy: string; createdAt: string; total: number; created: number; updated: number; skipped: number; needsApproval: boolean }

export const monthlyService = {
  history: () => api<{ uploads: UploadHistory[] }>('/monthly-uploads').then((r) => r.uploads),
  preview: (file: File) => uploadFile<{ plan: Plan }>('/monthly-uploads/preview', file).then((r) => r.plan),
  apply: (file: File) => uploadFile<{ result: UploadResult }>(`/monthly-uploads?filename=${encodeURIComponent(file.name)}`, file).then((r) => r.result),
  template: () => download('/monthly-uploads/template', 'protech-monthly-upload-template.xlsx'),
}
