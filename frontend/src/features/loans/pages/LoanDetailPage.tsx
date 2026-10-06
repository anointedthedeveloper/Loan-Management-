import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowUpRight, Ban, Banknote, Check, Download, FileText, FileX, Flag, Pencil, Send, ShieldAlert, X } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { ApiError, download } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useAsync } from '../../../hooks/useAsync'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Modal'
import { ReasonDialog } from '../../../components/ui/ReasonDialog'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { LoanStatusBadge, LoanTypeBadge } from '../../../components/ui/StatusBadge'
import { Tabs } from '../../../components/ui/Tabs'
import { formatDate, formatMoney, titleCase } from '../../../utils/format'
import { loanService } from '../services/loanService'
import { ScheduleTable } from '../components/ScheduleTable'
import { RecordRepaymentModal } from '../components/RecordRepaymentModal'
import { MarkInstallmentPaidModal, SettleLoanModal } from '../components/MarkPaidModals'
import type { Installment } from '../../../types/finance'
import { LoanRepaymentsList } from '../components/LoanRepaymentsList'
import { TransactionsTable } from '../../transactions/components/TransactionsTable'
import { RequestLoanChangeModal } from '../components/RequestLoanChangeModal'
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
  const [modal, setModal] = useState<'repay' | 'topup' | 'settle' | 'change' | Action | null>(null)
  const [marking, setMarking] = useState<Installment | null>(null)
  const [busy, setBusy] = useState(false)
  const [dl, setDl] = useState<string | null>(null)

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
  async function downloadSchedule(fmt: 'pdf' | 'xlsx' | 'csv') {
    setDl(fmt)
    try { await download(`/loans/${id}/schedule/export?format=${fmt}`, `schedule-${l.loanId}.${fmt}`) } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Download failed') } finally { setDl(null) }
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
          <div className="flex flex-wrap items-center gap-2"><h1 className="font-mono text-xl font-bold">{l.loanId}</h1><LoanStatusBadge status={l.status} /><LoanTypeBadge type={l.loanType} />{l.settledByTopUp && <Badge>Settled by top-up</Badge>}</div>
          <p className="mt-1 text-sm"><Link to={`/customers/${l.customer.id}`} className="font-medium text-brand-700 hover:underline">{l.customer.fullName}</Link> <span className="text-slate-500">· {l.customer.customerId} · {l.productName}</span></p>
          {l.statusReason && <p className="mt-1 text-sm text-slate-600">Reason: {l.statusReason}</p>}
          {live && l.overdueAmount > 0 && <p className="mt-2 text-sm font-medium text-red-600">{formatMoney(l.overdueAmount)} overdue · {l.daysOverdue} day(s)</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {l.status === 'pending' && can(PERM.loans.approve) && <><Button onClick={() => setModal('approve')}><Check className="size-4" />Approve</Button><Button variant="secondary" onClick={() => setModal('reject')}><X className="size-4" />Reject</Button></>}
          {((l.status === 'pending' && can(PERM.loans.edit)) || (['approved', 'active', 'overdue', 'defaulted'].includes(l.status) && can(PERM.loans.editActive))) && <Button variant="secondary" onClick={() => nav(`/loans/${l.id}/edit`)}><Pencil className="size-4" />Edit loan</Button>}
          {l.status === 'approved' && can(PERM.loans.approve) && <Button onClick={() => setModal('disburse')}><Send className="size-4" />Disburse</Button>}
          {['approved', 'active', 'overdue'].includes(l.status) && !can(PERM.loans.editActive) && can(PERM.loans.view) && <Button variant="secondary" onClick={() => setModal('change')}><Pencil className="size-4" />Request a change</Button>}
          {['pending', 'approved'].includes(l.status) && (can(PERM.loans.edit) || can(PERM.loans.approve)) && <Button variant="ghost" onClick={() => setModal('cancel')}><Ban className="size-4" />Cancel loan</Button>}
          {live && can(PERM.repayments.record) && <Button onClick={() => setModal('repay')}><Banknote className="size-4" />Record repayment</Button>}
          {!['pending', 'rejected', 'cancelled'].includes(l.status) && <Link to={`/loans/${l.id}/statement`}><Button variant="secondary"><FileText className="size-4" />Generate statement</Button></Link>}
          {live && (can(PERM.repayments.record) || can(PERM.loans.approve)) && <Button variant="secondary" onClick={() => setModal('settle')}><Flag className="size-4" />Settle loan</Button>}
          {live && can(PERM.topups.request) && <Button variant="secondary" onClick={() => setModal('topup')}><ArrowUpRight className="size-4" />Top-up</Button>}
          {['active', 'overdue'].includes(l.status) && can(PERM.loans.approve) && <Button variant="ghost" className="text-red-600" onClick={() => setModal('default')}><ShieldAlert className="size-4" />Mark defaulted</Button>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-700">Client information</h2>
          <dl className="mt-3 space-y-3">
            {([['IPPIS Number', l.customer.ippisNumber], ['Client Name', l.customer.fullName], ['Ministry / Organization', l.customer.ministry]] as [string, string | null | undefined][]).map(([k, v]) => <div key={k}><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm font-semibold">{v || <span className="font-normal text-slate-400">Not provided</span>}</dd></div>)}
          </dl>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-700">Loan information</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {([['Amount Taken', formatMoney(l.amount)], ['Principal', formatMoney(l.principal)], ...(l.rateBasis === 'per_month' ? [['Monthly interest', formatMoney(l.monthlyInterest ?? 0)]] : []), [l.rateBasis === 'per_loan' ? `Interest (one-time ${l.interestRate}%)` : 'Interest', formatMoney(l.interestAmount)], ['Total Loan', formatMoney(l.totalRepayment)], [`EMI (${titleCase(l.frequency)})`, `${formatMoney(l.installmentAmount)} × ${l.numberOfInstallments}`], ['Payment Date', formatDate(l.startDate)], ['First Repayment', formatDate(l.firstPaymentDate)], ['Final Due Date', formatDate(l.dueDate)]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{v}</dd></div>)}
          </dl>
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {cards.map(([k, v, c]) => <div key={k} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{k}</p><p className={`mt-1 text-lg font-bold tabular-nums ${c ?? ''}`}>{v}</p></div>)}
      </div>
      {(l.nonCashCredits ?? 0) > 0 && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Amount paid includes <b>{formatMoney(l.nonCashCredits)}</b> credited without cash (waived interest or a balance settled by a top-up).</p>}
      {live && l.nextInstallmentNumber && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">Next installment: <b>#{l.nextInstallmentNumber}</b> of {formatMoney(l.nextInstallmentAmount)} due <b>{formatDate(l.nextDueDate)}</b>.{l.creditBalance > 0 && <> Customer credit held: <b>{formatMoney(l.creditBalance)}</b>.</>}</p>}

      <Tabs tabs={[{ key: 'schedule', label: 'Repayment schedule' }, { key: 'repayments', label: 'Repayments' }, { key: 'transactions', label: 'All transactions' }, { key: 'terms', label: 'Terms & history' }]} active={tab} onChange={setTab} />
      <div key={tab} className="animate-fade-in rounded-xl border border-slate-200 bg-white shadow-sm">
        {tab === 'schedule' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">{l.frequency === 'monthly' ? 'Payment window opens on the 25th; each installment is due on the 30th (28/29 in February).' : ' '}</p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Download schedule:</span>
                {(['pdf', 'xlsx', 'csv'] as const).map((fmt) => (
                  <Button key={fmt} variant="secondary" className="!px-3 !py-1.5 !text-xs" loading={dl === fmt} loadingText="…" onClick={() => downloadSchedule(fmt)}><Download className="size-3.5" />{fmt === 'xlsx' ? 'Excel' : fmt.toUpperCase()}</Button>
                ))}
              </div>
            </div>
            <ScheduleTable rows={schedule} monthly={l.frequency === 'monthly' && !l.firstPaymentDateIsCustom} onMarkPaid={live && can(PERM.repayments.record) ? setMarking : undefined} />
          </>
        )}
        {tab === 'repayments' && (tx.error ? <ErrorState message={tx.error} onRetry={tx.reload} /> : tx.loading ? <div className="p-5"><Skeleton className="h-24 w-full" /></div> : <LoanRepaymentsList rows={tx.data?.data ?? []} />)}
        {tab === 'transactions' && (tx.error ? <ErrorState message={tx.error} onRetry={tx.reload} /> : tx.loading ? <div className="p-5"><Skeleton className="h-24 w-full" /></div> : tx.data?.data.length ? <TransactionsTable rows={tx.data.data} onChanged={() => { reload(); tx.reload() }} /> : <EmptyState icon={<FileX className="size-6" />} title="No transactions yet" hint="The disbursement and repayments appear here once recorded." />)}
        {tab === 'terms' && (
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['Interest rate', `${l.interestRate}% ${l.rateBasis === 'per_month' ? 'per month × months' : l.rateBasis === 'per_annum' ? 'per annum, pro-rated' : 'one-time flat, on the principal'}`], ['Interest charge', `${formatMoney(l.interestAmount)} — fixed once, on the original principal`], ['Bank deduction', `${l.bankDeductionRate}%`],
              ['Gross principal', formatMoney(l.principal)], ['Carried balance', formatMoney(l.carriedBalance)], ['Duration', `${l.duration.value} ${l.duration.unit}`],
              ['Frequency', titleCase(l.frequency)], ['Installments', `${l.numberOfInstallments} × ${formatMoney(l.installmentAmount)}`], ['Start date', formatDate(l.startDate)],
              ['First payment due', formatDate(l.firstPaymentDate)], ['Final due date', formatDate(l.dueDate)], ['Created by', l.createdBy?.name ?? '—'], ['Approved by', l.approvedBy?.name ?? '—'],
            ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm">{v}</dd></div>)}
            {l.topUpOf && <div><dt className="text-xs font-medium uppercase text-slate-500">Top-up of</dt><dd className="text-sm"><Link className="text-brand-700 hover:underline" to={`/loans/${l.topUpOf}`}>Original loan</Link></dd></div>}
            {l.notes && <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</dt><dd className="mt-0.5 text-sm">{l.notes}</dd></div>}
          </dl>
        )}
      </div>

      {marking && <MarkInstallmentPaidModal loan={l} installment={marking} onClose={() => setMarking(null)} onDone={() => { setMarking(null); done() }} />}
      {modal === 'settle' && <SettleLoanModal loan={l} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'repay' && <RecordRepaymentModal loan={l} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'change' && <RequestLoanChangeModal loanId={l.id} amount={l.amount} months={l.duration?.unit === 'months' ? l.duration.value : undefined} onClose={() => setModal(null)} onDone={() => setModal(null)} />}
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
