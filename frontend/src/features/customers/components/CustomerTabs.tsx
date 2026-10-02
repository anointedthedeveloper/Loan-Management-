import { useNavigate } from 'react-router-dom'
import { Banknote, Landmark, ReceiptText } from 'lucide-react'
import { FinancialMetricCard, ActivityList } from '../../../components/dashboard'
import { LoanStatusBadge } from '../../../components/ui/StatusBadge'
import { TransactionsTable } from '../../transactions/components/TransactionsTable'
import type { Loan, Transaction } from '../../../types/finance'
import { EmptyState, ErrorState } from '../../../components/ui/feedback'
import { formatDate, formatMoney } from '../../../utils/format'
import { customerService } from '../services/customerService'
import { useAsync } from '../../../hooks/useAsync'
import { useCustomerMeta } from '../hooks/useCustomerMeta'
import type { Customer } from '../types'

function Item({ label, value }: { label: string; value?: string | null }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 text-sm">{value || <span className="text-slate-400">Not provided</span>}</dd></div>
}
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">{children}</dl></section>
)

export function OverviewTab({ c }: { c: Customer }) {
  const meta = useCustomerMeta()
  const label = (list: { value: string; label: string }[] | undefined, v?: string) => list?.find((o) => o.value === v)?.label ?? v
  const by = (u: Customer['createdBy']) => (u && typeof u === 'object' ? u.name : null)
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Personal details">
        <Item label="Full name" value={c.fullName} /><Item label="Date of birth" value={c.dateOfBirth ? formatDate(c.dateOfBirth) : null} />
        <Item label="Gender" value={label(meta?.genders, c.gender)} /><Item label="Registered" value={formatDate(c.registrationDate)} />
      </Panel>
      <Panel title="Contact">
        <Item label="Phone" value={c.phone} /><Item label="Alternative phone" value={c.altPhone} /><Item label="Email" value={c.email} />
        <Item label="State / LGA" value={[c.state, c.lga].filter(Boolean).join(' / ')} />
        <div className="sm:col-span-2"><Item label="Address" value={c.address} /></div>
      </Panel>
      <Panel title="Identification">
        <Item label="Type" value={label(meta?.idTypes, c.idType)} /><Item label="Number" value={c.idNumber} />
      </Panel>
      <Panel title="Employment / business">
        <Item label="Employment type" value={label(meta?.employmentTypes, c.employment?.employmentType)} /><Item label="Occupation" value={c.employment?.occupation} />
        <div className="sm:col-span-2"><Item label="Employer / business" value={c.employment?.employerName} /></div>
        <Item label="IPPIS number" value={c.employment?.ippisNumber} /><Item label="Ministry / department" value={c.employment?.ministry} />
      </Panel>
      <Panel title="Emergency contact">
        <Item label="Name" value={c.emergencyContact?.name} /><Item label="Relationship" value={c.emergencyContact?.relationship} /><Item label="Phone" value={c.emergencyContact?.phone} />
      </Panel>
      <Panel title="Record">
        <Item label="Created by" value={by(c.createdBy)} /><Item label="Created" value={formatDate(c.createdAt)} />
        <Item label="Last updated by" value={by(c.updatedBy)} /><Item label="Last updated" value={formatDate(c.updatedAt)} />
        {c.legacyId && <Item label="Previous client number" value={c.legacyId} />}
        {c.notes && <div className="sm:col-span-2"><Item label="Notes" value={c.notes} /></div>}
      </Panel>
    </div>
  )
}

export function FinancialSummaryTab({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => customerService.summary(id), [id])
  if (error) return <ErrorState message={error} onRetry={reload} />
  const m = data?.metrics
  return (
    <div className="space-y-4">
      {!loading && !data?.available && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">{data?.message}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FinancialMetricCard label="Total borrowed" value={m?.totalBorrowed} />
        <FinancialMetricCard label="Total repaid" value={m?.totalRepaid} />
        <FinancialMetricCard label="Outstanding balance" value={m?.outstandingBalance} />
        {(['Active loans', 'Completed loans', 'Overdue loans'] as const).map((l, i) => {
          const v = m && [m.activeLoans, m.completedLoans, m.overdueLoans][i]
          return <div key={l} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-medium text-slate-500">{l}</p><p className="mt-2 text-3xl font-bold">{typeof v === 'number' ? v : <span className="text-base font-normal text-slate-400">—</span>}</p></div>
        })}
      </div>
    </div>
  )
}

/** Real, ledger-derived history for this customer. */
export function FinancialListTab({ id, kind }: { id: string; kind: 'loans' | 'repayments' | 'transactions' }) {
  const nav = useNavigate()
  const loans = useAsync(() => (kind === 'loans' ? customerService.loans(id) : Promise.resolve(null)), [id, kind])
  const tx = useAsync(() => (kind === 'loans' ? Promise.resolve(null) : kind === 'repayments' ? customerService.repayments(id) : customerService.transactions(id)), [id, kind])
  const state = kind === 'loans' ? loans : tx
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />
  const empty = { loans: { icon: Landmark, title: 'No loans yet', hint: 'Loans issued to this customer will be listed here.' }, repayments: { icon: Banknote, title: 'No repayments yet', hint: 'Repayment history will appear here once payments are recorded.' }, transactions: { icon: ReceiptText, title: 'No transactions yet', hint: 'The customer ledger will appear here once transactions are recorded.' } }[kind]
  const Icon = empty.icon
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {state.loading ? <div className="p-6 text-sm text-slate-400">Loading…</div>
        : kind === 'loans' && loans.data?.data.length ? (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Loan</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3">Status</th><th className="hidden px-4 py-3 md:table-cell">Start</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{(loans.data.data as Loan[]).map((l) => <tr key={l.id} onClick={() => nav(`/loans/${l.id}`)} className="cursor-pointer hover:bg-slate-50"><td className="px-4 py-3 font-mono text-xs">{l.loanId}</td><td className="px-4 py-3 text-right tabular-nums">{formatMoney(l.amount)}</td><td className="px-4 py-3 text-right tabular-nums">{formatMoney(l.outstandingBalance)}</td><td className="px-4 py-3"><LoanStatusBadge status={l.status} /></td><td className="hidden px-4 py-3 md:table-cell">{formatDate(l.startDate)}</td></tr>)}</tbody></table></div>)
        : kind !== 'loans' && tx.data?.data.length ? <TransactionsTable rows={tx.data.data as Transaction[]} onChanged={tx.reload} />
        : <EmptyState icon={<Icon className="size-6" />} title={empty.title} hint={empty.hint} />}
    </div>
  )
}

export function ActivityTab({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => customerService.activity(id), [id])
  if (error) return <ErrorState message={error} onRetry={reload} />
  return <div className="rounded-xl border border-slate-200 bg-white px-5 py-2 shadow-sm"><ActivityList items={data?.data} loading={loading} showDetails emptyText="No activity recorded for this customer." /></div>
}

