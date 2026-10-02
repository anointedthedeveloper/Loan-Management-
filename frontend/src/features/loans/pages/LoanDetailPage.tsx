import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowUpRight, Ban, Banknote, Check, FileX, Pencil, Send, ShieldAlert, X } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useAsync } from '../../../hooks/useAsync'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Modal'
import { ReasonDialog } from '../../../components/ui/ReasonDialog'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { LoanStatusBadge } from '../../../components/ui/StatusBadge'
import { Tabs } from '../../../components/ui/Tabs'
import { formatDate, formatMoney, titleCase } from '../../../utils/format'
import { loanService } from '../services/loanService'
import { ScheduleTable } from '../components/ScheduleTable'
import { RecordRepaymentModal } from '../components/RecordRepaymentModal'
import { TransactionsTable } from '../../transactions/components/TransactionsTable'
import { TopUpRequestModal } from '../../topups/components/TopUpRequestModal'

type Action = 'approve' | 'disburse' | 'reject' | 'cancel' | 'default'

export default function LoanDetailPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const { data, error, loading, reload } = useAsync(() => loanService.get(id), [id])
  const tx = useAsync(() => loanService.transactions(id), [id])
  const [tab, setTab] = useState('schedule')
  const [modal, setModal] = useState<'repay' | 'topup' | Action | null>(null)
  const [busy, setBusy] = useState(false)

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>
  const { loan: l, schedule } = data
  const live = ['active', 'overdue', 'defaulted'].includes(l.status)

  async function run(action: Action, reason?: string) {
    setBusy(true)
    try { await loanService.action(id, action, reason); toast('success', { approve: 'Loan approved', disburse: 'Loan disbursed', reject: 'Loan rejected', cancel: 'Loan cancelled', default: 'Loan marked as defaulted' }[action]); setModal(null); reload(); tx.reload() }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Action failed'); setModal(null) }
    finally { setBusy(false) }
  }
  const done = () => { setModal(null); reload(); tx.reload() }

  const cards: [string, string, string?][] = [
    ['Loan amount', formatMoney(l.amount)], ['Total repayment', formatMoney(l.totalRepayment)], ['Amount paid', formatMoney(l.amountPaid)],
    ['Outstanding', formatMoney(l.outstandingBalance), live && l.overdueAmount > 0 ? 'text-red-600' : ''],
    ['Principal balance', formatMoney(l.principalBalance)], ['Interest balance', formatMoney(l.interestBalance)],
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="font-mono text-xl font-bold">{l.loanId}</h1><LoanStatusBadge status={l.status} />{l.topUpOf && <Badge tone="blue">Top-up loan</Badge>}{l.settledByTopUp && <Badge>Settled by top-up</Badge>}</div>
          <p className="mt-1 text-sm"><Link to={`/customers/${l.customer.id}`} className="font-medium text-brand-700 hover:underline">{l.customer.fullName}</Link> <span className="text-slate-500">· {l.customer.customerId} · {l.productName}</span></p>
          {l.statusReason && <p className="mt-1 text-sm text-slate-600">Reason: {l.statusReason}</p>}
          {live && l.overdueAmount > 0 && <p className="mt-2 text-sm font-medium text-red-600">{formatMoney(l.overdueAmount)} overdue · {l.daysOverdue} day(s)</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {l.status === 'pending' && can(PERM.loans.approve) && <><Button onClick={() => setModal('approve')}><Check className="size-4" />Approve</Button><Button variant="secondary" onClick={() => setModal('reject')}><X className="size-4" />Reject</Button></>}
          {l.status === 'pending' && can(PERM.loans.edit) && <Button variant="secondary" onClick={() => nav(`/loans/${l.id}/edit`)}><Pencil className="size-4" />Edit</Button>}
          {l.status === 'approved' && can(PERM.loans.approve) && <Button onClick={() => setModal('disburse')}><Send className="size-4" />Disburse</Button>}
          {['pending', 'approved'].includes(l.status) && (can(PERM.loans.edit) || can(PERM.loans.approve)) && <Button variant="ghost" onClick={() => setModal('cancel')}><Ban className="size-4" />Cancel loan</Button>}
          {live && can(PERM.repayments.record) && <Button onClick={() => setModal('repay')}><Banknote className="size-4" />Record repayment</Button>}
          {live && can(PERM.topups.request) && <Button variant="secondary" onClick={() => setModal('topup')}><ArrowUpRight className="size-4" />Top-up</Button>}
          {['active', 'overdue'].includes(l.status) && can(PERM.loans.approve) && <Button variant="ghost" className="text-red-600" onClick={() => setModal('default')}><ShieldAlert className="size-4" />Mark defaulted</Button>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {cards.map(([k, v, c]) => <div key={k} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{k}</p><p className={`mt-1 text-lg font-bold tabular-nums ${c ?? ''}`}>{v}</p></div>)}
      </div>
      {live && l.nextInstallmentNumber && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">Next installment: <b>#{l.nextInstallmentNumber}</b> of {formatMoney(l.nextInstallmentAmount)} due <b>{formatDate(l.nextDueDate)}</b>.{l.creditBalance > 0 && <> Customer credit held: <b>{formatMoney(l.creditBalance)}</b>.</>}</p>}

      <Tabs tabs={[{ key: 'schedule', label: 'Repayment schedule' }, { key: 'transactions', label: 'Transactions' }, { key: 'terms', label: 'Terms & history' }]} active={tab} onChange={setTab} />
      <div key={tab} className="animate-fade-in rounded-xl border border-slate-200 bg-white shadow-sm">
        {tab === 'schedule' && <ScheduleTable rows={schedule} />}
        {tab === 'transactions' && (tx.error ? <ErrorState message={tx.error} onRetry={tx.reload} /> : tx.loading ? <div className="p-5"><Skeleton className="h-24 w-full" /></div> : tx.data?.data.length ? <TransactionsTable rows={tx.data.data} onChanged={() => { reload(); tx.reload() }} /> : <EmptyState icon={<FileX className="size-6" />} title="No transactions yet" hint="The disbursement and repayments appear here once recorded." />)}
        {tab === 'terms' && (
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['Interest', `${l.interestRate}% ${titleCase(l.rateBasis)} (flat)`], ['Interest amount', formatMoney(l.interestAmount)], ['Bank deduction', `${l.bankDeductionRate}%`],
              ['Gross principal', formatMoney(l.principal)], ['Carried balance', formatMoney(l.carriedBalance)], ['Duration', `${l.duration.value} ${l.duration.unit}`],
              ['Frequency', titleCase(l.frequency)], ['Installments', `${l.numberOfInstallments} × ${formatMoney(l.installmentAmount)}`], ['Start date', formatDate(l.startDate)],
              ['Final due date', formatDate(l.dueDate)], ['Created by', l.createdBy?.name ?? '—'], ['Approved by', l.approvedBy?.name ?? '—'],
            ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm">{v}</dd></div>)}
            {l.topUpOf && <div><dt className="text-xs font-medium uppercase text-slate-500">Top-up of</dt><dd className="text-sm"><Link className="text-brand-700 hover:underline" to={`/loans/${l.topUpOf}`}>Original loan</Link></dd></div>}
            {l.notes && <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</dt><dd className="mt-0.5 text-sm">{l.notes}</dd></div>}
          </dl>
        )}
      </div>

      {modal === 'repay' && <RecordRepaymentModal loan={l} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'topup' && <TopUpRequestModal loan={l} onClose={() => setModal(null)} onDone={done} />}
      <ConfirmDialog open={modal === 'approve'} loading={busy} title="Approve this loan?" confirmLabel="Approve loan" message={`Approving ${l.loanId} records a ${formatMoney(l.amount)} disbursement to ${l.customer.fullName} in the ledger and activates the loan.`} onConfirm={() => run('approve')} onCancel={() => setModal(null)} />
      <ConfirmDialog open={modal === 'disburse'} loading={busy} title="Disburse this loan?" confirmLabel="Disburse" message={`This records the ${formatMoney(l.amount)} payout and activates the loan.`} onConfirm={() => run('disburse')} onCancel={() => setModal(null)} />
      {(modal === 'reject' || modal === 'cancel' || modal === 'default') && (
        <ReasonDialog open danger loading={busy} title={{ reject: 'Reject loan', cancel: 'Cancel loan', default: 'Mark loan as defaulted' }[modal]} confirmLabel={{ reject: 'Reject loan', cancel: 'Cancel loan', default: 'Mark defaulted' }[modal]}
          message={{ reject: 'The customer will not receive funds. This is final and recorded in the audit log.', cancel: 'The loan will be closed without disbursement. This is recorded in the audit log.', default: 'The loan stays open for repayments but is flagged as defaulted. This is recorded in the audit log.' }[modal]}
          onConfirm={(r) => run(modal, r)} onCancel={() => setModal(null)} />
      )}
    </div>
  )
}
