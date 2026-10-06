import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, Landmark, Plus } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { reportService } from '../../reports/services/reportService'
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

export default function LoansPage({ completed = false }: { completed?: boolean }) {
  const { can } = useAuth()
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  async function exportBook() {
    setExporting(true)
    try { await reportService.export('loan-book', 'xlsx', {}) } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Export failed') } finally { setExporting(false) }
  }
  const nav = useNavigate()
  const [search] = useSearchParams()
  const meta = useLoanMeta()
  const list = useServerList(completed ? loanService.listCompleted : loanService.list, { q: '', status: search.get('status') ?? '', repaymentStatus: '', from: '', to: '', minAmount: '', maxAmount: '' }, { key: 'createdAt', order: 'desc' })
  const defs: FilterDef[] = [
    { key: 'q', type: 'search', placeholder: 'Search loan ID, customer name, phone or ID' },
    ...(completed ? [] : [
      { key: 'status', type: 'select', label: 'Status', options: (meta?.statuses ?? []).filter((s) => s.value !== 'completed'), all: 'All open statuses' } as FilterDef,
      { key: 'repaymentStatus', type: 'select', label: 'Repayment', options: repaymentStatuses.filter((s) => s.value !== 'paid'), all: 'Any' } as FilterDef,
    ]),
    { key: 'from', type: 'date', label: 'Start from' }, { key: 'to', type: 'date', label: 'Start to' },
    { key: 'minAmount', type: 'money', label: 'Min amount', placeholder: '0' }, { key: 'maxAmount', type: 'money', label: 'Max amount' },
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
        <div><h1 className="text-2xl font-bold tracking-tight">{completed ? 'Completed loans' : 'Loans'}</h1><p className="text-sm text-slate-500">{completed ? 'Fully repaid loans, kept here as a record. Open any to see its schedule, repayments and statement.' : 'Pending, running and overdue loans. Fully repaid loans move to Completed loans.'}</p></div>
        <div className="flex flex-wrap gap-2">
          {can(PERM.reports.export) && <Button variant="secondary" onClick={exportBook} loading={exporting} loadingText="Preparing…"><FileSpreadsheet className="size-4" />Loan book (Excel)</Button>}
          {!completed && can(PERM.loans.create) && <Link to="/loans/new"><Button><Plus className="size-4" />New loan</Button></Link>}
        </div>
      </div>
      <DataTable columns={cols} rows={list.rows} pg={list.pg} error={list.error} onRetry={list.reload} sort={list.sort} onSort={list.toggleSort} onPage={list.setPage}
        onRowClick={(l) => nav(`/loans/${l.id}`)} toolbar={<FilterBar defs={defs} value={list.filters} onChange={list.updateFilters} />}
        empty={<EmptyState icon={<Landmark className="size-6" />} title={list.filtered ? 'No loans match your filters' : completed ? 'No completed loans yet' : 'No open loans'} hint={list.filtered ? 'Try different filters or clear them.' : completed ? 'A loan appears here once it is fully repaid.' : 'Create a loan to see it here.'} />} />
    </div>
  )
}
