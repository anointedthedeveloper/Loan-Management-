import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, FileSpreadsheet, FileText, Printer, RefreshCw } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { formatDate, formatMoney, titleCase } from '../../../utils/format'
import type { Statement } from '../../../types/finance'
import { statementService, type StatementTarget } from '../services/statementService'

const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
const Item = ({ k, v }: { k: string; v: string }) => <div><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm font-semibold">{v}</dd></div>

/** Client / loan account statement: Date, Reference, Description, DR, CR, Balance — generated from the ledger. */
export default function StatementPage({ kind }: { kind: 'loan' | 'client' }) {
  const { id = '' } = useParams()
  const toast = useToast()
  const target: StatementTarget = { kind, id }
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [s, setS] = useState<Statement | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState('')

  async function generate() {
    setLoading(true); setError('')
    try { setS(await statementService.generate(target, { from: from || undefined, to: to || undefined })) }
    catch (e) { setS(null); setError(e instanceof ApiError ? e.message : 'Could not generate the statement') }
    finally { setLoading(false) }
  }
  useEffect(() => { void generate() }, [id, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  async function exportAs(f: 'pdf' | 'xlsx' | 'csv') {
    setExporting(f)
    try { await statementService.download(target, f, { from: from || undefined, to: to || undefined }) } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Download failed') } finally { setExporting('') }
  }
  const back = kind === 'loan' ? `/loans/${id}` : `/customers/${id}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div><h1 className="text-2xl font-bold tracking-tight">Account statement</h1><p className="text-sm text-slate-500">Generated from the ledger. Debit is what the client owes; credit is what has been paid or credited.</p></div>
        <Link to={back} className="text-sm font-medium text-brand-700 hover:underline">← Back</Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <label className="text-xs font-medium text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} mt-1 block`} /></label>
        <label className="text-xs font-medium text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} mt-1 block`} /></label>
        <Button onClick={generate} loading={loading} loadingText="Generating…"><RefreshCw className="size-4" />Generate statement</Button>
        {s && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
            {([['pdf', 'PDF', FileText], ['xlsx', 'Excel (with monthly breakdown)', FileSpreadsheet], ['csv', 'CSV', Download]] as const).map(([f, label, Icon]) => <Button key={f} variant="secondary" loading={exporting === f} onClick={() => exportAs(f)}><Icon className="size-4" />{label}</Button>)}
          </div>
        )}
      </div>

      {error ? <ErrorState message={error} onRetry={generate} /> : !s ? <Skeleton className="h-96 w-full" /> : (
        <article className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
            <div><p className="text-xl font-bold text-brand-900">{s.company.name}</p><p className="text-xs text-slate-500">{[s.company.address, s.company.phone, s.company.email].filter(Boolean).join(' · ')}</p></div>
            <div className="text-right text-xs text-slate-500"><p className="text-sm font-semibold text-ink">ACCOUNT STATEMENT</p><p>{s.period.from || s.period.to ? `${s.period.from ? formatDate(s.period.from) : 'Start'} – ${s.period.to ? formatDate(s.period.to) : 'Date'}` : 'All transactions'}</p><p>Generated {new Date(s.generatedAt).toLocaleString('en-NG')}</p></div>
          </header>

          <section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">Client information</h2>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Item k="IPPIS Number" v={s.client.ippisNumber ?? '—'} /><Item k="Client Name" v={s.client.name} /><Item k="Ministry / Organization" v={s.client.ministry ?? '—'} /><Item k="Client ID" v={s.client.customerId} /></dl></section>

          {s.loans.length === 0 ? <EmptyState title="No loan transactions yet" hint="A statement appears once a loan has been disbursed." /> : s.loans.map((l) => (
            <section key={l.loan.id} className="space-y-3 break-inside-avoid-page">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-700">Loan information · {l.loan.loanId} <span className="font-normal normal-case text-slate-500">({titleCase(l.loan.status)}{l.loan.loanType !== 'new' ? `, ${l.loan.loanType}` : ''})</span></h2>
              <dl className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-5 print:bg-transparent print:p-0">
                <Item k="Amount Taken" v={formatMoney(l.loan.amountTaken)} /><Item k="Principal" v={formatMoney(l.loan.principal)} /><Item k="Monthly interest" v={formatMoney(l.loan.monthlyInterest)} /><Item k="Interest (one-time total)" v={formatMoney(l.loan.interest)} /><Item k="Total Loan" v={formatMoney(l.loan.totalLoan)} />
                <Item k={`EMI (${l.loan.frequency})`} v={`${formatMoney(l.loan.emi)} × ${l.loan.numberOfInstallments}`} /><Item k="Payment Date" v={formatDate(l.loan.paymentDate)} /><Item k="First Repayment" v={formatDate(l.loan.firstRepaymentDate)} /><Item k="Final Due Date" v={formatDate(l.loan.finalDueDate)} />
              </dl>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-brand-900 text-xs uppercase tracking-wide text-white"><tr><th className="px-3 py-2.5">Transaction Date</th><th className="px-3 py-2.5">Reference Number</th><th className="px-3 py-2.5">Description / Details</th><th className="px-3 py-2.5 text-right">Debit (DR)</th><th className="px-3 py-2.5 text-right">Credit (CR)</th><th className="px-3 py-2.5 text-right">Balance</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {l.rows.map((r, i) => (
                      <tr key={i}><td className="whitespace-nowrap px-3 py-2">{formatDate(r.date)}</td><td className="px-3 py-2 font-mono text-xs">{r.reference}</td><td className="px-3 py-2">{r.description}</td>
                        <td className="px-3 py-2 text-right">{r.debit ? formatMoney(r.debit) : ''}</td><td className="px-3 py-2 text-right text-brand-700">{r.credit ? formatMoney(r.credit) : ''}</td><td className="px-3 py-2 text-right font-medium">{formatMoney(r.balance)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50 text-sm font-bold print:bg-transparent"><tr><td className="px-3 py-2.5" colSpan={3}>Totals · closing balance</td><td className="px-3 py-2.5 text-right">{formatMoney(l.totals.debit)}</td><td className="px-3 py-2.5 text-right">{formatMoney(l.totals.credit)}</td><td className="px-3 py-2.5 text-right">{formatMoney(l.totals.closingBalance)}</td></tr></tfoot>
                </table>
              </div>
              {l.schedule.length > 0 && (
                <details className="rounded-lg border border-slate-200 print:hidden">
                  <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-brand-700">Monthly breakdown ({l.schedule.length} installments) — also in the Excel download</summary>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">No.</th><th className="px-3 py-2">Month</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">EMI</th><th className="px-3 py-2 text-right">Principal</th><th className="px-3 py-2 text-right">Interest</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Remaining</th><th className="px-3 py-2">Status</th></tr></thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">{l.schedule.map((m) => <tr key={m.number}><td className="px-3 py-1.5">{m.number}</td><td className="px-3 py-1.5">{m.month}</td><td className="px-3 py-1.5">{formatDate(m.dueDate)}</td><td className="px-3 py-1.5 text-right">{formatMoney(m.emi)}</td><td className="px-3 py-1.5 text-right">{formatMoney(m.principal)}</td><td className="px-3 py-1.5 text-right">{formatMoney(m.interest)}</td><td className="px-3 py-1.5 text-right">{formatMoney(m.paid)}</td><td className="px-3 py-1.5 text-right">{formatMoney(m.remaining)}</td><td className="px-3 py-1.5">{titleCase(m.status)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>
          ))}
          {s.loans.length > 1 && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold print:bg-transparent">All loans — debit {formatMoney(s.summary.totalDebit)} · credit {formatMoney(s.summary.totalCredit)} · balance {formatMoney(s.summary.closingBalance)}</p>}
          <p className="text-xs text-slate-500">Balance is the amount still owed (debits less credits).</p>
        </article>
      )}
    </div>
  )
}
