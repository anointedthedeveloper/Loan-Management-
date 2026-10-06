import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { PERM } from '../../../config/permissions'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { reportService } from '../../reports/services/reportService'
import { formatDateTime, formatMoney } from '../../../utils/format'
import { monthlyService, type Plan, type PlanRow, type UploadHistory, type UploadResult } from '../services/monthlyService'

const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2>{hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}<div className="mt-4">{children}</div></section>
)
const ACTION: Record<PlanRow['action'], { label: string; tone: string }> = {
  'new-loan': { label: 'New loan', tone: 'bg-green-100 text-green-800' }, 'top-up': { label: 'Top-up', tone: 'bg-blue-100 text-blue-800' }, 'update-loan': { label: 'Update loan', tone: 'bg-amber-100 text-amber-800' },
  'update-customer': { label: 'Update customer', tone: 'bg-amber-100 text-amber-800' }, unchanged: { label: 'No change', tone: 'bg-slate-100 text-slate-600' }, error: { label: 'Skipped', tone: 'bg-red-100 text-red-800' },
}

/** Download the register, edit it in Excel, upload it back; or upload new loans in the same layout. */
export default function MonthlyUploadPage() {
  const { can } = useAuth()
  const toast = useToast()
  const approver = can(PERM.loans.approve)
  const [file, setFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [history, setHistory] = useState<UploadHistory[] | null>(null)
  const [busy, setBusy] = useState('')
  const loadHistory = () => monthlyService.history().then(setHistory).catch(() => setHistory([]))
  useEffect(() => { void loadHistory() }, [])

  const run = async (key: string, fn: () => Promise<unknown>, fail: string) => { setBusy(key); try { await fn() } catch (e) { toast('error', e instanceof ApiError ? e.message : fail) } finally { setBusy('') } }
  const choose = (f: File) => run('check', async () => { setFile(f); setPlan(null); setResult(null); setPlan(await monthlyService.preview(f)) }, 'Could not read the file')
  const todo = plan ? plan.counts.newLoans + plan.counts.loanUpdates + plan.counts.customerUpdates : 0
  const submit = () => file && run('apply', async () => {
    const r = await monthlyService.apply(file); setResult(r); setPlan(null); setFile(null); void loadHistory()
    toast(r.skipped ? 'error' : 'success', `${r.created} loan(s) ${r.needsApproval ? 'sent for approval' : 'created'}, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}`)
  }, 'Upload failed')

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">Monthly upload</h1><p className="text-sm text-slate-500">Download the sheet, change what needs changing, upload it back.</p></div>

      <Card title="1. Download">
        <div className="flex flex-wrap gap-2">
          {can(PERM.reports.export) && (['xlsx', 'pdf', 'csv'] as const).map((f) => (
            <Button key={f} variant={f === 'xlsx' ? 'primary' : 'secondary'} loading={busy === f} onClick={() => run(f, () => reportService.export('customer-register', f, {}), 'Download failed')}><Download className="size-4" />{f === 'xlsx' ? 'Register (Excel, editable)' : `Register (${f.toUpperCase()})`}</Button>
          ))}
          <Button variant="secondary" loading={busy === 'tpl'} onClick={() => run('tpl', () => monthlyService.template(), 'Download failed')}><FileSpreadsheet className="size-4" />Empty template</Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">The Excel register is the upload format. Details in the FAQ.</p>
      </Card>

      <Card title="2. Upload">
        <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${approver ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          {approver ? 'New loans you upload go live straight away.' : 'New loans you upload are sent to the CEO for approval; the CEO can edit them first.'}
        </p>
        <input type="file" accept=".xlsx" id="monthly-file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = '' }} />
        <label htmlFor="monthly-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-700"><Upload className="size-4" />{file ? file.name : 'Choose the .xlsx file'}</label>
        {busy === 'check' && <p className="mt-3 text-sm text-slate-500">Checking the file…</p>}

        {plan && (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {([['New loans', plan.counts.newLoans, 'bg-green-100 text-green-800'], ['Loan updates', plan.counts.loanUpdates, 'bg-amber-100 text-amber-800'], ['Customer updates', plan.counts.customerUpdates, 'bg-amber-100 text-amber-800'], ['No change', plan.counts.unchanged, 'bg-slate-100 text-slate-600'], ['Problems', plan.counts.errors, 'bg-red-100 text-red-800']] as [string, number, string][]).map(([k, v, tone]) => <span key={k} className={`rounded-full px-3 py-1 font-semibold ${tone}`}>{v} {k.toLowerCase()}</span>)}
              <span className="text-slate-500">Nothing has been saved yet.</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">What happens</th><th className="px-3 py-2 text-right">Principal</th><th className="px-3 py-2 text-right">Interest</th><th className="px-3 py-2 text-right">EMI</th></tr></thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {plan.rows.filter((r) => r.action !== 'unchanged').map((r) => (
                    <tr key={r.row} className={r.action === 'error' ? 'bg-red-50/50' : ''}>
                      <td className="px-3 py-2 text-slate-500">{r.row}</td>
                      <td className="px-3 py-2"><p className="font-medium">{r.matchedName ?? r.name}</p><p className="text-xs text-slate-500">{r.customerRef ?? r.clientId ?? '—'} · IPPIS {r.ippis || '—'}</p></td>
                      <td className="px-3 py-2 text-xs">
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${ACTION[r.action].tone}`}>{ACTION[r.action].label}{r.loanRef && r.action === 'update-loan' ? ` ${r.loanRef}` : ''}{r.topUpOfRef ? ` (liquidates ${r.topUpOfRef})` : ''}</span>
                        {[...r.customerChanges, ...r.loanChanges].map((m, i) => <p key={i} className="mt-0.5 text-slate-700">{m}</p>)}
                        {r.errors.map((m, i) => <p key={`e${i}`} className="mt-0.5 text-red-700"><AlertTriangle className="mr-1 inline size-3" />{m}</p>)}
                        {r.warnings.map((m, i) => <p key={`w${i}`} className="mt-0.5 text-amber-700">{m}</p>)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.principal !== undefined ? formatMoney(r.principal) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.interest !== undefined ? formatMoney(r.interest) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.emi !== undefined ? formatMoney(r.emi) : ''}</td>
                    </tr>
                  ))}
                  {plan.rows.every((r) => r.action === 'unchanged') && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Nothing in this file differs from what is already in the portal.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setPlan(null); setFile(null) }}>Cancel</Button>
              <Button disabled={todo === 0} loading={busy === 'apply'} loadingText="Saving…" onClick={submit}>{plan.counts.newLoans && !approver ? 'Save and send new loans for approval' : 'Apply these changes'}</Button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-5 space-y-2 rounded-lg border border-slate-200 p-4 text-sm">
            <p className="font-semibold">{result.created} loan(s) {result.needsApproval ? 'waiting for the CEO' : 'created'}, {result.updated} updated, {result.unchanged} unchanged{result.skipped > 0 && `, ${result.skipped} skipped`}.</p>
            <ul className="space-y-1">
              {result.rows.filter((r) => r.status !== 'unchanged').map((r) => (
                <li key={r.row} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-slate-500">Row {r.row}</span><span className="font-medium">{r.name}</span>
                  {r.loan ? <Link to={`/loans/${r.loan}`} className="font-mono text-xs text-brand-700 hover:underline">{r.loanRef} · {r.status}</Link> : <span className={r.status === 'skipped' ? 'text-red-700' : 'text-slate-600'}>{r.status === 'skipped' ? 'skipped: ' : ''}{r.messages.join(' ')}</span>}
                </li>
              ))}
            </ul>
            {result.needsApproval && result.created > 0 && <Link to="/loans?status=pending" className="inline-block font-medium text-brand-700 hover:underline">Open the pending loans</Link>}
          </div>
        )}
      </Card>

      <Card title="Recent uploads">
        {!history ? <p className="text-sm text-slate-500">Loading…</p> : history.length === 0 ? <p className="text-sm text-slate-500">No uploads yet.</p> : (
          <table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">When</th><th>File</th><th>By</th><th className="text-right">Loans</th><th className="text-right">Updated</th><th className="text-right">Skipped</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{history.map((u) => <tr key={u.id}><td className="py-2">{formatDateTime(u.createdAt)}</td><td>{u.filename}</td><td>{u.uploadedBy}</td><td className="text-right tabular-nums">{u.created}{u.needsApproval && u.created > 0 ? ' (approval)' : ''}</td><td className="text-right tabular-nums">{u.updated}</td><td className="text-right tabular-nums">{u.skipped}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  )
}
