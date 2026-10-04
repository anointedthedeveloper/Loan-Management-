import { useEffect, useState } from 'react'
import { BarChart3, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useAsync } from '../../../hooks/useAsync'
import { Button } from '../../../components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { formatDate, formatMoney, formatNumber, titleCase } from '../../../utils/format'
import type { ReportCol, ReportResult } from '../types'
import { reportService } from '../services/reportService'

const cell = (c: ReportCol, v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : c.type === 'money' ? formatMoney(Number(v)) : c.type === 'date' ? formatDate(String(v)) : c.type === 'number' ? formatNumber(Number(v)) : c.type === 'status' ? titleCase(String(v)) : String(v))
const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'

export default function ReportsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const catalog = useAsync(() => reportService.catalog(), [])
  const [key, setKey] = useState('loans')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    reportService.run(key, { from: from || undefined, to: to || undefined }).then((r) => { if (live) setResult(r) }).catch((e) => { if (live) { setResult(null); setError(e instanceof ApiError ? e.message : 'Could not load report') } }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [key, from, to])

  async function exportAs(f: 'csv' | 'xlsx' | 'pdf') {
    setExporting(f)
    try { await reportService.export(key, f, { from: from || undefined, to: to || undefined }) } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Export failed') } finally { setExporting('') }
  }
  const info = catalog.data?.find((r) => r.key === key)
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">Reports</h1><p className="text-sm text-slate-500">Generated live from the ledger. Filter by date and export for accounts or audit.</p></div>
      <div className="grid gap-5 lg:grid-cols-4">
        <nav aria-label="Reports" className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm lg:col-span-1">
          {catalog.loading ? <Skeleton className="h-48 w-full" /> : (catalog.data ?? []).map((r) => (
            <button key={r.key} onClick={() => setKey(r.key)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${key === r.key ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}>{r.label}</button>
          ))}
        </nav>
        <section className="space-y-4 lg:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">{info?.label}</h2><p className="text-sm text-slate-500">{info?.description}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} mt-1 block`} /></label>
              <label className="text-xs font-medium text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} mt-1 block`} /></label>
              {(from || to) && <button className="pb-2 text-sm font-medium text-brand-600 hover:underline" onClick={() => { setFrom(''); setTo('') }}>Clear dates</button>}
              {can(PERM.reports.export) && (
                <div className="ml-auto flex flex-wrap gap-2">
                  {([['csv', 'CSV', Download], ['xlsx', 'Excel', FileSpreadsheet], ['pdf', 'PDF', FileText]] as const).filter(([f]) => !(key === 'loan-book' && f === 'pdf')).map(([f, label, Icon]) => <Button key={f} variant="secondary" loading={exporting === f} onClick={() => exportAs(f)}><Icon className="size-4" />{label}</Button>)}
                </div>
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {error ? <ErrorState message={error} onRetry={() => setKey((k) => k)} /> : loading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              : !result || result.rows.length === 0 ? <EmptyState icon={<BarChart3 className="size-6" />} title="No data for this report" hint="Try a wider date range, or record activity first." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{result.columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-4 py-3 ${c.type === 'money' || c.type === 'number' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">{result.rows.map((r, i) => <tr key={i}>{result.columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-4 py-2.5 ${c.type === 'money' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody>
                  {result.totals && <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold"><tr>{result.columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-4 py-2.5 ${c.type === 'money' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}>{result.totals![c.key] === undefined ? '' : cell(c, result.totals![c.key])}</td>)}</tr></tfoot>}
                </table>
              </div>
            )}
            {result?.truncated && <p className="border-t border-slate-200 px-4 py-2 text-xs text-amber-700">Showing the first {result.rows.length} rows. Narrow the dates or export for the full list.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
