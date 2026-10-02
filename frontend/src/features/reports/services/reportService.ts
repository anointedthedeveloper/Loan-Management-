import { api, download, qs } from '../../../services/api'
import type { ReportInfo, ReportResult } from '../types'

export const reportService = {
  catalog: () => api<{ reports: ReportInfo[] }>('/reports').then((r) => r.reports),
  run: (key: string, p: { from?: string; to?: string }) => api<ReportResult>(`/reports/${key}${qs({ ...p, limit: 500 })}`),
  export: (key: string, format: 'csv' | 'xlsx' | 'pdf', p: { from?: string; to?: string }) => download(`/reports/${key}${qs({ ...p, format, limit: 5000 })}`, `protech-${key}.${format}`),
}
