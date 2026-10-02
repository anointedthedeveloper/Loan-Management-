import { useState } from 'react'
import { Download, ScrollText } from 'lucide-react'
import { api, apiPage, download, qs, ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { useAsync } from '../../../hooks/useAsync'
import { useServerList } from '../../../hooks/useServerList'
import { DataTable, type Column } from '../../../components/ui/DataTable'
import { Drawer, DetailList } from '../../../components/ui/Drawer'
import { Badge, EmptyState } from '../../../components/ui/feedback'
import { FilterBar, type FilterDef } from '../../../components/ui/FilterBar'
import { formatDateTime, humanizeAction } from '../../../utils/format'
import type { ActivityEntry } from '../../../types'

const toneFor = (a: string) => (a === 'PAGE_VIEW' ? 'blue' : a === 'LOGIN' || a === 'LOGOUT' ? 'slate' : a.includes('REJECT') || a.includes('DELETE') || a.includes('DEACTIVAT') || a.includes('REVERS') || a.includes('FAILED') ? 'red' : a.includes('CREATED') || a.includes('APPROVED') || a.includes('RECORDED') ? 'green' : 'slate')
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export default function AuditLogPage() {
  const meta = useAsync(() => api<{ actions: string[]; users: { id: string; name: string }[] }>('/audit-logs/meta'), [])
  const toast = useToast()
  const list = useServerList((p) => apiPage<ActivityEntry>(`/audit-logs${qs({ ...p, sort: undefined, order: undefined })}`), { q: '', category: '', role: '', action: '', entity: '', user: '', from: '', to: '' }, { key: 'createdAt', order: 'desc' }, 20)
  const [exporting, setExporting] = useState(false)
  async function exportCsv() {
    setExporting(true)
    try { await download(`/audit-logs/export${qs({ ...list.filters, q: list.filters.q || undefined })}`, 'audit-log.csv') } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Export failed') } finally { setExporting(false) }
  }
  const [sel, setSel] = useState<ActivityEntry | null>(null)
  const defs: FilterDef[] = [
    { key: 'q', type: 'search', placeholder: 'Search by reference (e.g. LN-000001), page or person' },
    { key: 'category', type: 'select', label: 'What', all: 'Everything', options: [{ value: 'changes', label: 'Things done (changes)' }, { value: 'navigation', label: 'Pages visited' }, { value: 'auth', label: 'Sign-ins & sign-outs' }] },
    { key: 'role', type: 'select', label: 'Role', all: 'All roles', options: [{ value: 'ceo', label: 'CEO / Admin' }, { value: 'accountant', label: 'Accountant' }] },
    { key: 'action', type: 'select', label: 'Action', options: (meta.data?.actions ?? []).map((a) => ({ value: a, label: humanizeAction(a) })) },
    { key: 'entity', type: 'select', label: 'Record type', options: ['Customer', 'Loan', 'LoanProduct', 'Transaction', 'TopUp', 'User', 'Settings', 'Report'].map((v) => ({ value: v, label: v })) },
    { key: 'user', type: 'select', label: 'Account', options: (meta.data?.users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'from', type: 'date', label: 'From' }, { key: 'to', type: 'date', label: 'To' },
  ]
  const cols: Column<ActivityEntry>[] = [
    { key: 'time', label: 'When', render: (a) => <span className="whitespace-nowrap text-slate-600">{formatDateTime(a.createdAt)}</span> },
    { key: 'action', label: 'Action', render: (a) => <Badge tone={toneFor(a.action)}>{humanizeAction(a.action)}</Badge> },
    { key: 'ref', label: 'Record', render: (a) => (a.action === 'PAGE_VIEW' ? <span className="font-medium">{String((a.after as { page?: string } | null)?.page ?? a.entityLabel)} <span className="font-mono text-xs font-normal text-slate-400">{a.entityLabel}</span></span> : <><span className="text-xs text-slate-500">{a.entity}</span> <span className="font-medium">{a.entityLabel ?? a.entityId?.slice(-6)}</span></>) },
    { key: 'user', label: 'By', hideBelow: 'md', render: (a) => <><span>{a.userName ?? 'System'}</span>{a.userRole && <span className="ml-1.5 text-xs capitalize text-slate-400">{a.userRole}</span>}</> },
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">Audit log</h1><p className="text-sm text-slate-500">Everything people do in the system: pages visited, sign-ins, and every change — with who, their role, and exactly when.</p></div>
        <Button variant="secondary" onClick={exportCsv} loading={exporting} loadingText="Exporting…"><Download className="size-4" />Export CSV</Button></div>
      <DataTable columns={cols} rows={list.rows} pg={list.pg} error={list.error} onRetry={list.reload} onPage={list.setPage} onRowClick={setSel}
        toolbar={<FilterBar defs={defs} value={list.filters} onChange={list.updateFilters} />}
        empty={<EmptyState icon={<ScrollText className="size-6" />} title="No audit entries match" hint="Adjust the filters to see more activity." />} />
      <Drawer open={!!sel} title={sel ? humanizeAction(sel.action) : ''} onClose={() => setSel(null)}>
        {sel && (
          <div className="space-y-5">
            <DetailList items={[['When', formatDateTime(sel.createdAt)], ['By', `${sel.userName ?? 'System'}${sel.userRole ? ` (${sel.userRole})` : ''}`], ['Record', `${sel.entity ?? ''} ${sel.entityLabel ?? ''}`.trim()], ['IP address', sel.ip]]} />
            {(sel.before || sel.after) && (
              <div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Changes</p>
                <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="pb-1">Field</th><th className="pb-1">Before</th><th className="pb-1">After</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 align-top">{[...new Set([...Object.keys(sel.before ?? {}), ...Object.keys(sel.after ?? {})])].map((k) => <tr key={k}><td className="py-1.5 pr-2 font-medium">{k}</td><td className="py-1.5 pr-2 break-words text-slate-500">{show(sel.before?.[k])}</td><td className="py-1.5 break-words">{show(sel.after?.[k])}</td></tr>)}</tbody></table></div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
