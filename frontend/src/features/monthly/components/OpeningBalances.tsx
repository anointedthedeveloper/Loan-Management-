import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Upload } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { PERM } from '../../../config/permissions'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { formatDate, formatMoney } from '../../../utils/format'
import { monthlyService, type BalancePlan, type UploadResult } from '../services/monthlyService'

/** Brings in what customers already owe ("balances as at 30 Sep") so they can be repaid against and topped up. */
export function OpeningBalances({ onDone }: { onDone: () => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const approver = can(PERM.loans.approve)
  const [file, setFile] = useState<File | null>(null)
  const [asAt, setAsAt] = useState('')
  const [plan, setPlan] = useState<BalancePlan | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [busy, setBusy] = useState('')
  const run = async (key: string, fn: () => Promise<void>, fail: string) => { setBusy(key); try { await fn() } catch (e) { toast('error', e instanceof ApiError ? e.message : fail) } finally { setBusy('') } }
  const check = (f: File, date = asAt) => run('check', async () => { setFile(f); setResult(null); setPlan(null); const p = await monthlyService.balancesPreview(f, date); setPlan(p); if (!date) setAsAt(p.asAt.slice(0, 10)) }, 'Could not read the file')
  const [progress, setProgress] = useState('')
  // A few rows at a time, so a long sheet never runs into the server's time limit; progress is shown and a failure says where it stopped.
  const submit = () => file && run('apply', async () => {
    let offset = 0; let uploadId = ''; let created = 0; let skipped = 0; let needsApproval = false; const rows: UploadResult['rows'] = []
    try {
      for (;;) {
        const r = await monthlyService.balancesApply(file, asAt, offset, uploadId)
        uploadId = r.id; offset = r.nextOffset; created += r.created; skipped += r.skipped; needsApproval = r.needsApproval; rows.push(...r.rows)
        setProgress(`Recorded ${Math.min(offset, r.count)} of ${r.count}…`)
        if (r.done) break
      }
    } catch (e) {
      setResult({ id: uploadId, filename: file.name, total: rows.length, created, updated: 0, unchanged: 0, skipped, needsApproval, rows })
      throw new ApiError(`Stopped after ${offset} row(s): ${e instanceof ApiError ? e.message : 'the connection failed'}. ${created} loan(s) were saved. Check Loans, then upload the same file again; people who already have a loan are skipped.`, 0, 'PARTIAL')
    } finally { setProgress(''); onDone() }
    setResult({ id: uploadId, filename: file.name, total: rows.length, created, updated: 0, unchanged: 0, skipped, needsApproval, rows }); setPlan(null); setFile(null)
    toast(skipped ? 'error' : 'success', `${created} loan(s) ${needsApproval ? 'sent for approval' : 'recorded'}${skipped ? `, ${skipped} skipped` : ''}`)
  }, 'Upload failed')
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Opening balances</h2>
      <p className="mt-0.5 text-sm text-slate-500">Upload the loans running at a date: Client ID, Clients Name, IPPIS NO, Ministry, Loan, Repayment to date and Balance as at. The Loan becomes the customer's running loan, the Repayment to date is recorded as already paid, and the balance is what is left, so it can be repaid and topped up. No cash is paid out. A sheet with only a Balance column uses the balance as the loan.</p>
      <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${approver ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{approver ? 'Balances go live straight away.' : 'Balances are sent to the CEO for approval.'} Customers who already have an open loan are skipped; people not in the portal are added with their Client ID.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div><label htmlFor="bal-date" className="block text-xs font-medium text-slate-600">Balance as at</label><input id="bal-date" type="date" value={asAt} onChange={(e) => { setAsAt(e.target.value); if (file) void check(file, e.target.value) }} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
        <input type="file" accept=".xlsx" id="balances-file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void check(f, asAt); e.target.value = '' }} />
        <label htmlFor="balances-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-700"><Upload className="size-4" />{file ? file.name : 'Choose the balances .xlsx'}</label>
      </div>
      {busy === 'check' && <p className="mt-3 text-sm text-slate-500">Checking the file…</p>}
      {plan && (
        <div className="mt-4 space-y-3">
          <p className="text-sm"><b>{plan.counts.balances}</b> loan(s): <b>{formatMoney(plan.counts.loans)}</b> lent, <b>{formatMoney(plan.counts.repaid)}</b> repaid, <b>{formatMoney(plan.counts.total)}</b> still owed as at {formatDate(plan.asAt)}{plan.counts.newCustomers ? `, ${plan.counts.newCustomers} new customer(s)` : ''}{plan.counts.skipped ? `, ${plan.counts.skipped} with nothing owed (skipped)` : ''}{plan.counts.errors ? `, ${plan.counts.errors} problem(s)` : ''}. <span className="text-slate-500">Nothing has been saved yet.</span></p>
          {plan.rows.some((r) => r.errors.length || (r.warnings.length && r.action !== 'skipped')) && (
            <ul className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 p-3 text-xs">
              {plan.rows.filter((r) => r.errors.length || (r.warnings.length && r.action !== 'skipped')).map((r) => (
                <li key={r.row} className="py-0.5"><span className="text-slate-500">Row {r.row}</span> <b>{r.matchedName ?? r.name}</b> {r.errors.map((m, i) => <span key={i} className="text-red-700"><AlertTriangle className="mx-1 inline size-3" />{m}</span>)}{r.warnings.map((m, i) => <span key={i} className="ml-1 text-amber-700">{m}</span>)}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setPlan(null); setFile(null) }}>Cancel</Button><Button disabled={plan.counts.balances === 0} loading={busy === 'apply'} loadingText={progress || 'Saving…'} onClick={submit}>{approver ? 'Record these loans' : 'Send for approval'}</Button></div>
        </div>
      )}
      {result && (
        <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm">
          <p className="font-semibold">{result.created} balance(s) {result.needsApproval ? 'waiting for the CEO' : 'recorded'}{result.skipped ? `, ${result.skipped} skipped` : ''}.</p>
          {result.rows.some((x) => x.status === 'skipped') && <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs text-red-700">{result.rows.filter((x) => x.status === 'skipped').map((x) => <li key={x.row}>Row {x.row} {x.name}: {x.messages.join(' ')}</li>)}</ul>}
          {result.needsApproval && result.created > 0 && <Link to="/loans?status=pending" className="mt-1 inline-block font-medium text-brand-700 hover:underline">Open the pending loans</Link>}
        </div>
      )}
    </section>
  )
}
