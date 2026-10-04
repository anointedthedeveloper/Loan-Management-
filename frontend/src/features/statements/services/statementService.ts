import { api, download, qs } from '../../../services/api'
import type { Statement } from '../../../types/finance'

export type StatementTarget = { kind: 'loan' | 'client'; id: string }
const base = (t: StatementTarget) => (t.kind === 'loan' ? `/loans/${t.id}/statement` : `/customers/${t.id}/statement`)

export const statementService = {
  generate: (t: StatementTarget, p: { from?: string; to?: string; scope?: string }) => api<{ statement: Statement }>(`${base(t)}${qs({ ...p, format: 'json' })}`).then((r) => r.statement),
  download: (t: StatementTarget, format: 'pdf' | 'xlsx' | 'csv', p: { from?: string; to?: string; scope?: string }) => download(`${base(t)}${qs({ ...p, format })}`, `statement.${format}`),
}
