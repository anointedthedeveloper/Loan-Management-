import { useEffect, useState } from 'react'
import { UserCog, Users } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import type { ActivityEntry, Tone } from '../../types'
import { ActivityList, ChartCard, FinancialMetricCard, MetricCard, StatusBreakdown } from '../../components/dashboard'
import { ErrorState } from '../../components/ui/feedback'

interface Overview {
  customers?: { total: number; byStatus: { value: string; label: string; tone: Tone; count: number }[] }
  staff?: { total: number; active: number }
  recentActivity?: ActivityEntry[]
}

/** Shows only what the API returns for this user's permissions. Money metrics stay placeholders until Phases 3-7. */
export default function DashboardPage({ variant }: { variant: 'ceo' | 'accountant' }) {
  const { user } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [key, setKey] = useState(0)

  useEffect(() => {
    setError('')
    api<Overview>('/dashboard/overview').then(setData).catch((e) => setError(e instanceof ApiError ? e.message : 'Unexpected error'))
  }, [key])

  if (!user) return null
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const loading = !data && !error
  const ceo = variant === 'ceo'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greet}, {user.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">{ceo ? 'Executive overview' : 'Daily operations'}</p>
      </div>
      {error ? <ErrorState message={error} onRetry={() => setKey((k) => k + 1)} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(loading || data?.customers) && <MetricCard label="Total customers" value={data?.customers?.total} loading={loading} icon={<Users className="size-5" />} />}
            {(loading || data?.customers) && <MetricCard label="Active customers" value={data?.customers?.byStatus.find((s) => s.value === 'active')?.count} loading={loading} />}
            {data?.staff && <MetricCard label="Staff accounts" value={data.staff.total} hint={`${data.staff.active} active`} icon={<UserCog className="size-5" />} />}
            <FinancialMetricCard label="Active loans" />
            {ceo && <FinancialMetricCard label="Total disbursed" />}
            {ceo && <FinancialMetricCard label="Outstanding principal" />}
            {ceo && <FinancialMetricCard label="Total collected" />}
            {!ceo && <FinancialMetricCard label="Today's repayments" />}
            {!ceo && <FinancialMetricCard label="Overdue accounts" />}
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {ceo && <ChartCard title="Monthly collections" empty="Collections chart appears once repayments are recorded." />}
              {data?.recentActivity && <ActivityList title="System activity" items={data.recentActivity} />}
            </div>
            <div className="space-y-6">
              {(loading || data?.customers) && <StatusBreakdown title="Customers by status" items={data?.customers?.byStatus} loading={loading} />}
              <ChartCard title="Loan status breakdown" empty="Appears once loans exist." />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
