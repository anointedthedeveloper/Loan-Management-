export interface ReportCol { key: string; label: string; type: 'text' | 'money' | 'date' | 'number' | 'status' }
export interface ReportResult { key: string; title: string; columns: ReportCol[]; rows: Record<string, string | number | null>[]; totals: Record<string, string | number | null> | null; from: string | null; to: string | null; truncated: boolean }
export interface ReportInfo { key: string; label: string; description: string }
