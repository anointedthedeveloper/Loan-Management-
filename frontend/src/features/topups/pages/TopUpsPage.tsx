import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Plus, X } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useServerList } from '../../../hooks/useServerList'
import { Button } from '../../../components/ui/Button'
import { DataTable, type Column } from '../../../components/ui/DataTable'
import { Drawer, DetailList } from '../../../components/ui/Drawer'
import { ConfirmDialog } from '../../../components/ui/Modal'
import { ReasonDialog } from '../../../components/ui/ReasonDialog'
import { EmptyState } from '../../../components/ui/feedback'
import { FilterBar, type FilterDef } from '../../../components/ui/FilterBar'
import { TopUpStatusBadge } from '../../../components/ui/StatusBadge'
import { formatDate, formatMoney } from '../../../utils/format'
import type { TopUp } from '../../../types/finance'
import { topupService } from '../services/topupService'
import { TopUpCalculation, TopUpRequestModal } from '../components/TopUpRequestModal'

export default function TopUpsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const list = useServerList(topupService.list, { status: '', from: '', to: '' }, { key: 'createdAt', order: 'desc' })
  const [sel, setSel] = useState<TopUp | null>(null)
  const [adding, setAdding] = useState(false)
  const [act, setAct] = useState<'approve' | 'reject' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const defs: FilterDef[] = [
    { key: 'status', type: 'select', label: 'Status', options: ['pending', 'approved', 'rejected', 'cancelled'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) },
    { key: 'from', type: 'date', label: 'From' }, { key: 'to', type: 'date', label: 'To' },
  ]
  const cols: Column<TopUp>[] = [
    { key: 'id', label: 'Top-up', render: (t) => <span className="font-mono text-xs">{t.topUpId}</span> },
    { key: 'customer', label: 'Customer', render: (t) => t.customer?.fullName },
    { key: 'loan', label: 'Existing loan', hideBelow: 'md', render: (t) => t.loan?.loanId },
    { key: 'amount', label: 'New funds', align: 'right', render: (t) => formatMoney(t.requestedAmount) },
    { key: 'total', label: 'New total', align: 'right', hideBelow: 'lg', render: (t) => formatMoney(t.calculation?.terms.totalRepayment) },
    { key: 'status', label: 'Status', render: (t) => <TopUpStatusBadge status={t.status} /> },
    { key: 'date', label: 'Requested', hideBelow: 'lg', render: (t) => formatDate(t.createdAt) },
  ]

  async function run(reason?: string) {
    if (!sel || !act) return
    setBusy(true)
    try { await topupService.action(sel.id, act, reason); toast('success', { approve: 'Top-up approved', reject: 'Top-up rejected', cancel: 'Top-up cancelled' }[act]); setAct(null); setSel(null); list.reload() }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Action failed'); setAct(null) }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Top-ups</h1><p className="text-sm text-slate-500">Additional funds for existing borrowers. The original loan is never overwritten.</p></div>
        {can(PERM.topups.request) && <Button onClick={() => setAdding(true)}><Plus className="size-4" />Request top-up</Button>}
      </div>
      <DataTable columns={cols} rows={list.rows} pg={list.pg} error={list.error} onRetry={list.reload} onPage={list.setPage} onRowClick={setSel}
        toolbar={<FilterBar defs={defs} value={list.filters} onChange={list.updateFilters} />}
        empty={<EmptyState icon={<ArrowUpRight className="size-6" />} title={list.filtered ? 'No top-ups match your filters' : 'No top-ups yet'} hint="Request a top-up from an active loan." />} />
      <Drawer open={!!sel} title={sel?.topUpId ?? ''} onClose={() => setSel(null)}>
        {sel && (
          <div className="space-y-5">
            <TopUpStatusBadge status={sel.status} />
            <DetailList items={[['Customer', sel.customer ? <Link className="text-brand-700 hover:underline" to={`/customers/${sel.customer.id}`}>{sel.customer.fullName}</Link> : null], ['Existing loan', sel.loan ? <Link className="text-brand-700 hover:underline" to={`/loans/${sel.loan.id}`}>{sel.loan.loanId}</Link> : null],
              ['Resulting loan', sel.resultingLoan ? <Link className="text-brand-700 hover:underline" to={`/loans/${sel.resultingLoan.id}`}>{sel.resultingLoan.loanId}</Link> : null], ['Requested by', sel.requestedBy?.name], ['Approved by', sel.approvedBy?.name], ['Notes', sel.notes], ['Reason', sel.statusReason]]} />
            {sel.calculation && <TopUpCalculation c={sel.calculation} />}
            {sel.settlement && <p className="rounded-lg bg-brand-50 p-3 text-sm">Existing loan settled: {formatMoney(sel.settlement.settled)} (carried {formatMoney(sel.settlement.carriedForward)}{sel.settlement.waived > 0 && `, waived ${formatMoney(sel.settlement.waived)}`}) into {sel.settlement.intoLoan}.</p>}
            {sel.status === 'pending' && (
              <div className="flex flex-wrap gap-2">
                {can(PERM.topups.approve) && <><Button onClick={() => setAct('approve')}><Check className="size-4" />Approve</Button><Button variant="secondary" onClick={() => setAct('reject')}><X className="size-4" />Reject</Button></>}
                {(can(PERM.topups.request) || can(PERM.topups.approve)) && <Button variant="ghost" onClick={() => setAct('cancel')}>Cancel request</Button>}
              </div>
            )}
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={act === 'approve'} loading={busy} title="Approve this top-up?" confirmLabel="Approve top-up" message="The position is recalculated with the latest balance, a new loan is created, and the funds are recorded in the ledger. The original loan is settled according to the configured top-up rules." onConfirm={() => run()} onCancel={() => setAct(null)} />
      {(act === 'reject' || act === 'cancel') && <ReasonDialog open danger required={act === 'reject'} loading={busy} title={act === 'reject' ? 'Reject top-up' : 'Cancel top-up request'} confirmLabel={act === 'reject' ? 'Reject' : 'Cancel request'} message="This is recorded in the audit log." onConfirm={run} onCancel={() => setAct(null)} />}
      {adding && <TopUpRequestModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload() }} />}
    </div>
  )
}
