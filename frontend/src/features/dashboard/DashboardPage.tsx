import { useEffect, useState, type ReactNode } from 'react'
import { greetingFor, greetingName } from '../../utils/greeting'
import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, Landmark, Users, UserCog } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import type { ActivityEntry, Tone } from '../../types'
import type { Loan, Transaction } from '../../types/finance'
import { ActivityList, ChartCard, MetricCard, StatusBreakdown } from '../../components/dashboard'
import { GroupedBarChart, HorizontalBars } from '../../components/charts/BarChart'
import { ErrorState } from '../../components/ui/feedback'
import { LoanStatusBadge } from '../../components/ui/StatusBadge'
import { formatDate, formatMoney, formatMoneyShort, formatNumber } from '../../utils/format'

interface Overview {
  customers?: { incompleteProfiles?: number; total: number; byStatus: { value: string; label: string; tone: Tone; count: number }[] }
  recentCustomers?: { id: string; customerId: string; fullName: string; status: string; registrationDate: string }[]
  staff?: { total: number; active: number }
  recentActivity?: ActivityEntry[]
  financial?: {
    activeLoans: number; totalDisbursed: number; totalCollected: number; outstandingPrincipal: number; outstandingTotal: number; totalExpected: number
    overdueAmount: number; overdueLoans: number; loanStatusBreakdown: { value: string; label: string; tone: Tone; count: number }[]
    outstandingByStatus: { value: string; label: string; amount: number }[]; monthly: { month: string; collected: number; disbursed: number }[]
  }
  recentLoans?: Loan[]
  overdueAccounts?: { id: string; loanId: string; customer: string; customerId: string; overdueAmount: number; daysOverdue: number }[]
  upcomingRepayments?: { id: string; loanId: string; customer: string; installment: number; dueDate: string; amount: number }[]
  todayRepayments?: { count: number; amount: number }
  recentRepayments?: Transaction[]
  recentTransactions?: Transaction[]
}

const Card = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">{title}</h2>{action}</div><div className="mt-3">{children}</div></section>
)
const Empty = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">{text}</p>
const Row = ({ to, left, sub, right }: { to?: string; left: ReactNode; sub?: ReactNode; right: ReactNode }) => {
  const inner = <><div className="min-w-0"><p className="truncate text-sm font-medium">{left}</p>{sub && <p className="text-xs text-slate-500">{sub}</p>}</div><div className="shrink-0 text-right text-sm tabular-nums">{right}</div></>
  return <li>{to ? <Link to={to} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">{inner}</Link> : <div className="flex items-center justify-between gap-3 px-2 py-2.5">{inner}</div>}</li>
}

/** Everything here comes from GET /dashboard/overview, already filtered by the user's permissions. */
export default function DashboardPage({ variant }: { variant: 'ceo' | 'accountant' }) {
  const { user } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [key, setKey] = useState(0)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, []) // keeps the greeting right as the day goes on
  useEffect(() => { setError(''); api<Overview>('/dashboard/overview').then(setData).catch((e) => setError(e instanceof ApiError ? e.message : 'Unexpected error')) }, [key])
  if (!user) return null
  const greet = greetingFor(now)
  const loading = !data && !error
  const fin = data?.financial
  const ceo = variant === 'ceo'

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold tracking-tight">{greet}, {greetingName(user.name)}</h1><p className="mt-1 text-sm text-slate-500">{ceo ? 'Executive overview' : 'Daily operations'} · figures are calculated live from the ledger</p></div>
      {error ? <ErrorState message={error} onRetry={() => setKey((k) => k + 1)} /> : (
        <>
          {!!data?.customers?.incompleteProfiles && (
            <Link to="/customers?profile=incomplete" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:bg-amber-100">
              <span><b>{formatNumber(data.customers.incompleteProfiles)}</b> customer profile{data.customers.incompleteProfiles === 1 ? ' is' : 's are'} incomplete (phone, NIN, BVN, address, date of birth... still missing).</span>
              <span className="font-semibold underline">Complete them</span>
            </Link>
          )}
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(loading || data?.customers) && <MetricCard label="Total customers" value={formatNumber(data?.customers?.total)} loading={loading} icon={<Users className="size-5" />} />}
            {(loading || fin) && <MetricCard label="Active loans" value={formatNumber(fin?.activeLoans)} loading={loading} icon={<Landmark className="size-5" />} />}
            {ceo && fin && <>
              <MetricCard label="Total disbursed" value={formatMoneyShort(fin.totalDisbursed)} />
              <MetricCard label="Outstanding principal" value={formatMoneyShort(fin.outstandingPrincipal)} />
              <MetricCard label="Total expected repayment" value={formatMoneyShort(fin.totalExpected)} hint="Across all disbursed loans" />
              <MetricCard label="Total collected" value={formatMoneyShort(fin.totalCollected)} />
              <MetricCard label="Overdue amount" value={<span className={fin.overdueAmount > 0 ? 'text-red-600' : ''}>{formatMoneyShort(fin.overdueAmount)}</span>} icon={<AlertTriangle className="size-5" />} />
              <MetricCard label="Overdue loans" value={formatNumber(fin.overdueLoans)} />
            </>}
            {!ceo && data?.todayRepayments && <MetricCard label="Today's repayments" value={formatMoneyShort(data.todayRepayments.amount)} hint={`${data.todayRepayments.count} payment(s)`} icon={<Banknote className="size-5" />} />}
            {!ceo && fin && <>
              <MetricCard label="Overdue accounts" value={formatNumber(fin.overdueLoans)} hint={formatMoneyShort(fin.overdueAmount) + ' overdue'} />
              <MetricCard label="Outstanding balances" value={formatMoneyShort(fin.outstandingTotal)} />
            </>}
            {data?.staff && <MetricCard label="Staff accounts" value={data.staff.total} hint={`${data.staff.active} active`} icon={<UserCog className="size-5" />} />}
          </div>

          {fin && (
            <div className="grid gap-6 lg:grid-cols-3">
              {ceo && <div className="lg:col-span-2"><ChartCard title="Monthly collections and disbursements"><GroupedBarChart data={fin.monthly as unknown as Record<string, number | string>[]} labelKey="month" series={[{ key: 'collected', label: 'Collected', color: '#14855c' }, { key: 'disbursed', label: 'Disbursed', color: '#94a3b8' }]} /></ChartCard></div>}
              <div className={ceo ? '' : 'lg:col-span-1'}><ChartCard title="Outstanding balance by status"><HorizontalBars items={fin.outstandingByStatus.map((s) => ({ label: s.label, value: s.amount }))} /></ChartCard></div>
              <StatusBreakdown title="Loans by status" items={fin.loanStatusBreakdown} />
              {data?.customers && <StatusBreakdown title="Customers by status" items={data.customers.byStatus} />}
            </div>
          )}
          {!fin && data?.customers && <StatusBreakdown title="Customers by status" items={data.customers.byStatus} loading={loading} />}

          <div className="stagger grid gap-6 lg:grid-cols-2">
            {data?.recentRepayments && <Card title="Recent repayments" action={<Link to="/repayments" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
              {data.recentRepayments.length ? <ul className="divide-y divide-slate-100">{data.recentRepayments.map((t) => <Row key={t.id} to={t.loan ? `/loans/${t.loan.id}` : undefined} left={t.customer?.fullName} sub={`${t.loan?.loanId ?? ''} · ${formatDate(t.date)}`} right={formatMoney(t.amount)} />)}</ul> : <Empty text="No repayments recorded yet." />}</Card>}
            {data?.recentLoans && <Card title="Recent loans" action={<Link to="/loans" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
              {data.recentLoans.length ? <ul className="divide-y divide-slate-100">{data.recentLoans.map((l) => <Row key={l.id} to={`/loans/${l.id}`} left={l.customer.fullName} sub={`${l.loanId} · ${formatMoney(l.amount)}`} right={<LoanStatusBadge status={l.status} />} />)}</ul> : <Empty text="No loans created yet." />}</Card>}
            {data?.overdueAccounts && <Card title="Overdue accounts">
              {data.overdueAccounts.length ? <ul className="divide-y divide-slate-100">{data.overdueAccounts.map((o) => <Row key={o.id} to={`/loans/${o.id}`} left={o.customer} sub={`${o.loanId} · ${o.daysOverdue} day(s) overdue`} right={<span className="text-red-600">{formatMoney(o.overdueAmount)}</span>} />)}</ul> : <Empty text="No overdue accounts." />}</Card>}
            {data?.upcomingRepayments && <Card title="Upcoming repayments (next 7 days)">
              {data.upcomingRepayments.length ? <ul className="divide-y divide-slate-100">{data.upcomingRepayments.map((u, i) => <Row key={i} to={`/loans/${u.id}`} left={u.customer} sub={`${u.loanId} · installment ${u.installment} · ${formatDate(u.dueDate)}`} right={formatMoney(u.amount)} />)}</ul> : <Empty text="Nothing due in the next 7 days." />}</Card>}
            {data?.recentTransactions && !ceo && <Card title="Recent transactions" action={<Link to="/transactions" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
              {data.recentTransactions.length ? <ul className="divide-y divide-slate-100">{data.recentTransactions.map((t) => <Row key={t.id} left={`${t.transactionId} · ${t.type}`} sub={`${t.customer?.fullName ?? ''} · ${formatDate(t.date)}`} right={formatMoney(t.amount)} />)}</ul> : <Empty text="No transactions yet." />}</Card>}
            {data?.recentCustomers && !ceo && <Card title="Customer activity" action={<Link to="/customers" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
              {data.recentCustomers.length ? <ul className="divide-y divide-slate-100">{data.recentCustomers.map((c) => <Row key={c.id} to={`/customers/${c.id}`} left={c.fullName} sub={`${c.customerId} · registered ${formatDate(c.registrationDate)}`} right="" />)}</ul> : <Empty text="No customers yet." />}</Card>}
            {data?.recentActivity && <div className="lg:col-span-2"><ActivityList title="System activity" items={data.recentActivity} /></div>}
          </div>
        </>
      )}
    </div>
  )
}
