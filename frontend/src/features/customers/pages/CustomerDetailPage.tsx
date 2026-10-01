import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Phone, Mail } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { useAuth } from '../../../context/AuthContext'
import { Button } from '../../../components/ui/Button'
import { ErrorState, Skeleton } from '../../../components/ui/feedback'
import { Tabs, type TabDef } from '../../../components/ui/Tabs'
import { customerService } from '../services/customerService'
import { useAsync } from '../hooks/useAsync'
import { CustomerStatusBadge } from '../components/CustomerStatusBadge'
import { ActivityTab, FinancialListTab, FinancialSummaryTab, OverviewTab } from '../components/CustomerTabs'

export default function CustomerDetailPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const nav = useNavigate()
  const { data: c, error, loading, reload } = useAsync(() => customerService.get(id), [id])
  const [tab, setTab] = useState('overview')

  // Tabs are filtered by permission so users never see sections the API would refuse.
  const tabs: TabDef[] = [
    { key: 'overview', label: 'Overview' },
    ...(can(PERM.customers.viewFinancials) ? [{ key: 'summary', label: 'Financial summary' }, { key: 'loans', label: 'Loans' }, { key: 'repayments', label: 'Repayments' }, { key: 'transactions', label: 'Transactions' }] : []),
    ...(can(PERM.audit.view) ? [{ key: 'activity', label: 'Activity' }] : []),
  ]

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !c) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-700">{c.firstName[0]}{c.lastName[0]}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold tracking-tight">{c.fullName}</h1><CustomerStatusBadge status={c.status} /></div>
            <p className="font-mono text-xs text-slate-500">{c.customerId}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-slate-600"><span className="flex items-center gap-1"><Phone className="size-3.5" />{c.phone}</span>{c.email && <span className="flex items-center gap-1"><Mail className="size-3.5" />{c.email}</span>}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => nav('/customers')}>Back</Button>
          {can(PERM.customers.update) && <Link to={`/customers/${c.id}/edit`}><Button><Pencil className="size-4" />Edit</Button></Link>}
        </div>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div key={tab} className="animate-fade-in">
        {tab === 'overview' && <OverviewTab c={c} />}
        {tab === 'summary' && <FinancialSummaryTab id={c.id} />}
        {(tab === 'loans' || tab === 'repayments' || tab === 'transactions') && <FinancialListTab id={c.id} kind={tab} />}
        {tab === 'activity' && <ActivityTab id={c.id} />}
      </div>
    </div>
  )
}
