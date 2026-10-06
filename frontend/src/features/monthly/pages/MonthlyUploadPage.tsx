import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { PERM } from '../../../config/permissions'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { reportService } from '../../reports/services/reportService'
import { formatDateTime, formatMoney } from '../../../utils/format'
import { monthlyService, type Plan, type UploadHistory, type UploadResult } from '../services/monthlyService'

const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2>{hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}<div className="mt-4">{children}</div></section>
)

/** One place for the monthly paperwork: download the customer register, upload the month's loans taken. */
export default function MonthlyUploadPage() {
  const { can } = useAuth()
  const toast = useToast()
  const approver = can(PERM.loans.approve)
  const [file, setFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [history, setHistory] = useState<UploadHistory[] | null>(null)
  const [busy, setBusy] = useState<string>('')
  const loadHistory = () => monthlyService.history().then(setHistory).catch(() => setHistory([]))
  useEffect(() => { void loadHistory() }, [])

  const run = async (key: string, fn: () => Promise<unknown>, fail: string) => { setBusy(key); try { await fn() } catch (e) { toast('error', e instanceof ApiError ? e.message : fail) } finally { setBusy('') } }
  const choose = (f: File) => run('check', async () => { setFile(f); setPlan(null); setResult(null); setPlan(await monthlyService.preview(f)) }, 'Could not read the file').then(() => undefined)
  const submit = () => file && run('apply', async () => {
    const r = await monthlyService.apply(file); setResult(r); setPlan(null); setFile(null); void loadHistory()
    toast(r.skipped ? 'error' : 'success', r.needsApproval ? `${r.created} loan(s) sent to the CEO for approval${r.skipped ? `, ${r.skipped} skipped` : ''}` : `${r.created} loan(s) created${r.skipped ? `, ${r.skipped} skipped` : ''}`)
  }, 'Upload failed')

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">Monthly upload</h1><p className="text-sm text-slate-500">Upload the month's loans taken in Protech's sheet format, and download the register of every customer with their current loan.</p></div>

      <Card title="Download" hint="The register has every customer once: client ID, IPPIS, ministry, status and their current loan (completed loans are not included). The template is the sheet to fill in for the upload.">
        <div className="flex flex-wrap gap-2">
          {can(PERM.reports.export) && (['xlsx', 'pdf', 'csv'] as const).map((f) => (
            <Button key={f} variant="secondary" loading={busy === f} onClick={() => run(f, () => reportService.export('customer-register', f, {}), 'Download failed')}><Download className="size-4" />Customer register ({f === 'xlsx' ? 'Excel' : f.toUpperCase()})</Button>
          ))}
          <Button variant="secondary" loading={busy === 'tpl'} onClick={() => run('tpl', () => monthlyService.template(), 'Download failed')}><FileSpreadsheet className="size-4" />Upload template (Excel)</Button>
        </div>
      </Card>

      <Card title="Upload loans taken" hint="Columns: Clients ID, Clients Name, IPPIS NO, MINISTRY, Tenor, Payment Date, Balance B/Fwd, Bank payment, EMI, Start Date, Status (NEW, TOP UP or RENEWAL). Each row is matched to a customer by client number and IPPIS.">
        <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${approver ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          {approver ? 'As an approver, the loans you upload are created and go live straight away. A TOP UP row liquidates the customer\'s running loan.' : 'The loans you upload are sent to the CEO for approval. The CEO can edit each one before approving it. A TOP UP only liquidates the old loan once approved.'}
        </p>
        <input type="file" accept=".xlsx" id="monthly-file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = '' }} />
        <label htmlFor="monthly-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-700"><Upload className="size-4" />{file ? file.name : 'Choose the .xlsx file'}</label>
        {busy === 'check' && <p className="mt-3 text-sm text-slate-500">Checking the file…</p>}

        {plan && (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-green-100 px-3 py-1 font-semibold text-green-800">{plan.willCreate} ready</span>
              {plan.errors > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-semibold text-red-800">{plan.errors} with problems (will be skipped)</span>}
              <span className="text-slate-500">Priced with {plan.product}. Nothing has been saved yet.</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Bank payment</th><th className="px-3 py-2 text-right">Principal</th><th className="px-3 py-2 text-right">Interest</th><th className="px-3 py-2 text-right">EMI</th><th className="px-3 py-2">Result</th></tr></thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {plan.rows.map((r) => (
                    <tr key={r.row} className={r.status === 'error' ? 'bg-red-50/50' : ''}>
                      <td className="px-3 py-2 text-slate-500">{r.row}</td>
                      <td className="px-3 py-2"><p className="font-medium">{r.matchedName ?? r.name}</p><p className="text-xs text-slate-500">{r.customerRef ?? r.clientId ?? '—'} · IPPIS {r.ippis || '—'}</p></td>
                      <td className="px-3 py-2 text-xs font-semibold">{r.type ?? '—'}{r.topUpOfRef && <span className="block font-normal text-slate-500">liquidates {r.topUpOfRef}</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.bank !== undefined ? formatMoney(r.bank) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.principal !== undefined ? formatMoney(r.principal) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.interest !== undefined ? formatMoney(r.interest) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.emi !== undefined ? formatMoney(r.emi) : '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.status === 'create' ? <span className="inline-flex items-center gap-1 font-semibold text-green-700"><CheckCircle2 className="size-3.5" />{approver ? 'Create' : 'Submit for approval'}</span> : <span className="inline-flex items-center gap-1 font-semibold text-red-700"><AlertTriangle className="size-3.5" />Skipped</span>}
                        {[...r.errors.map((m) => ({ m, e: true })), ...r.warnings.map((m) => ({ m, e: false }))].map(({ m, e }, i) => <p key={i} className={e ? 'text-red-700' : 'text-amber-700'}>{m}</p>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setPlan(null); setFile(null) }}>Cancel</Button>
              <Button disabled={plan.willCreate === 0} loading={busy === 'apply'} loadingText="Saving…" onClick={submit}>{approver ? `Create ${plan.willCreate} loan${plan.willCreate === 1 ? '' : 's'}` : `Submit ${plan.willCreate} loan${plan.willCreate === 1 ? '' : 's'} for approval`}</Button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-5 space-y-2 rounded-lg border border-slate-200 p-4 text-sm">
            <p className="font-semibold">{result.needsApproval ? `${result.created} loan(s) are waiting for the CEO's approval.` : `${result.created} loan(s) created.`}{result.skipped > 0 && ` ${result.skipped} row(s) were skipped.`}</p>
            <ul className="space-y-1">
              {result.rows.map((r) => (
                <li key={r.row} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-slate-500">Row {r.row}</span><span className="font-medium">{r.name}</span>
                  {r.loan ? <Link to={`/loans/${r.loan}`} className="font-mono text-xs text-brand-700 hover:underline">{r.loanRef} · {r.status}</Link> : <span className="text-red-700">skipped: {r.messages.join(' ')}</span>}
                </li>
              ))}
            </ul>
            {result.needsApproval && result.created > 0 && <Link to="/loans?status=pending" className="inline-block font-medium text-brand-700 hover:underline">Open the pending loans</Link>}
          </div>
        )}
      </Card>

      <Card title="Recent uploads">
        {!history ? <p className="text-sm text-slate-500">Loading…</p> : history.length === 0 ? <p className="text-sm text-slate-500">No uploads yet.</p> : (
          <table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">When</th><th>File</th><th>By</th><th className="text-right">Created</th><th className="text-right">Skipped</th><th className="pl-4">Approval</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{history.map((u) => <tr key={u.id}><td className="py-2">{formatDateTime(u.createdAt)}</td><td>{u.filename}</td><td>{u.uploadedBy}</td><td className="text-right tabular-nums">{u.created}</td><td className="text-right tabular-nums">{u.skipped}</td><td className="pl-4 text-xs">{u.needsApproval ? 'Sent for approval' : 'Created directly'}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  )
}
