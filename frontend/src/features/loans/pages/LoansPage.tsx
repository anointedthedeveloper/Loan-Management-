import { Link, useNavigate } from 'react-router-dom'
import { Landmark, Plus } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { useAuth } from '../../../context/AuthContext'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { useServerList } from '../../../hooks/useServerList'
import { Button } from '../../../components/ui/Button'
import { DataTable, type Column } from '../../../components/ui/DataTable'
import { EmptyState } from '../../../components/ui/feedback'
import { FilterBar, type FilterDef } from '../../../components/ui/FilterBar'
import { LoanStatusBadge, LoanTypeBadge } from '../../../components/ui/StatusBadge'
import { formatDate, formatMoney } from '../../../utils/format'
import type { Loan } from '../../../types/finance'
import { loanService } from '../services/loanService'

const repaymentStatuses = [{ value: 'unpaid', label: 'Not started' }, { value: 'partial', label: 'Partly paid' }, { value: 'paid', label: 'Fully paid' }, { value: 'overdue', label: 'Overdue' }]

export default function LoansPage() {
  const { can } = useAuth()
  const nav = useNavigate()
  const meta = useLoanMeta()
  const list = useServerList(loanService.list, { q: '', status: '', repaymentStatus: '', from: '', to: '', minAmount: '', maxAmount: '' }, { key: 'createdAt', order: 'desc' })
  const defs: FilterDef[] = [
    { key: 'q', type: 'search', placeholder: 'Search loan ID, customer name, phone or ID' },
    { key: 'status', type: 'select', label: 'Status', options: meta?.statuses ?? [], all: 'All statuses' },
    { key: 'repaymentStatus', type: 'select', label: 'Repayment', options: repaymentStatuses, all: 'Any' },
    { key: 'from', type: 'date', label: 'Start from' }, { key: 'to', type: 'date', label: 'Start to' },
    { key: 'minAmount', type: 'number', label: 'Min amount', placeholder: '0' }, { key: 'maxAmount', type: 'number', label: 'Max amount' },
  ]
  const cols: Column<Loan>[] = [
    { key: 'loanId', label: 'Loan', sortKey: 'loanId', render: (l) => <span className="font-mono text-xs">{l.loanId}</span> },
    { key: 'customer', label: 'Customer', render: (l) => <><p className="font-medium">{l.customer.fullName}</p><p className="text-xs text-slate-500">{l.productName} <LoanTypeBadge type={l.loanType} /></p></> },
    { key: 'amount', label: 'Amount', sortKey: 'amount', align: 'right', hideBelow: 'md', render: (l) => formatMoney(l.amount) },
    { key: 'out', label: 'Outstanding', sortKey: 'outstandingBalance', align: 'right', render: (l) => formatMoney(l.outstandingBalance) },
    { key: 'next', label: 'Next due', hideBelow: 'lg', render: (l) => (l.nextDueDate && ['active', 'overdue', 'defaulted'].includes(l.status) ? formatDate(l.nextDueDate) : '—') },
    { key: 'status', label: 'Status', sortKey: 'status', render: (l) => <LoanStatusBadge status={l.status} /> },
    { key: 'start', label: 'Start', sortKey: 'startDate', hideBelow: 'lg', render: (l) => formatDate(l.startDate) },
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Loans</h1><p className="text-sm text-slate-500">Every loan, with balances calculated from the ledger.</p></div>
        {can(PERM.loans.create) && <Link to="/loans/new"><Button><Plus className="size-4" />New loan</Button></Link>}
      </div>
      <DataTable columns={cols} rows={list.rows} pg={list.pg} error={list.error} onRetry={list.reload} sort={list.sort} onSort={list.toggleSort} onPage={list.setPage}
        onRowClick={(l) => nav(`/loans/${l.id}`)} toolbar={<FilterBar defs={defs} value={list.filters} onChange={list.updateFilters} />}
        empty={<EmptyState icon={<Landmark className="size-6" />} title={list.filtered ? 'No loans match your filters' : 'No loans yet'} hint={list.filtered ? 'Try different filters or clear them.' : 'Create the first loan to see it here.'} />} />
    </div>
  )
}
