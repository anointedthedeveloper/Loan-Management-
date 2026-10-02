import { useState } from 'react'
import { Banknote, Plus } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { useAuth } from '../../../context/AuthContext'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { useServerList } from '../../../hooks/useServerList'
import { Button } from '../../../components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { FilterBar, type FilterDef } from '../../../components/ui/FilterBar'
import { Pagination } from '../../../components/ui/Pagination'
import { TransactionsTable } from '../../transactions/components/TransactionsTable'
import { RecordRepaymentModal } from '../../loans/components/RecordRepaymentModal'
import { repaymentService } from '../services/repaymentService'

export default function RepaymentsPage() {
  const { can } = useAuth()
  const meta = useLoanMeta()
  const list = useServerList(repaymentService.list, { q: '', method: '', state: '', from: '', to: '', minAmount: '', maxAmount: '' }, { key: 'date', order: 'desc' })
  const [adding, setAdding] = useState(false)
  const defs: FilterDef[] = [
    { key: 'q', type: 'search', placeholder: 'Search transaction ID, reference or customer' }, { key: 'method', type: 'select', label: 'Method', options: meta?.paymentMethods ?? [] },
    { key: 'state', type: 'select', label: 'State', options: [{ value: 'posted', label: 'Posted' }, { value: 'reversed', label: 'Reversed' }] },
    { key: 'from', type: 'date', label: 'From' }, { key: 'to', type: 'date', label: 'To' }, { key: 'minAmount', type: 'money', label: 'Min ₦' }, { key: 'maxAmount', type: 'money', label: 'Max ₦' },
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Repayments</h1><p className="text-sm text-slate-500">Payments received. Recording one updates the ledger, balances, schedule and loan status automatically.</p></div>
        {can(PERM.repayments.record) && <Button onClick={() => setAdding(true)}><Plus className="size-4" />Record repayment</Button>}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar defs={defs} value={list.filters} onChange={list.updateFilters} />
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.rows ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          : list.rows.length === 0 ? <EmptyState icon={<Banknote className="size-6" />} title={list.filtered ? 'No repayments match your filters' : 'No repayments yet'} hint="Repayments recorded against loans appear here." />
          : <TransactionsTable rows={list.rows} onChanged={list.reload} />}
        {list.pg && !list.error && <Pagination p={list.pg} onPage={list.setPage} />}
      </div>
      {adding && <RecordRepaymentModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload() }} />}
    </div>
  )
}
