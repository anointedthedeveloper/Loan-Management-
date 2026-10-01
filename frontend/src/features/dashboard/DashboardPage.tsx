import { CheckCircle2, Circle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Badge } from '../../components/ui/feedback'

const roadmap = [
  { phase: 'Phase 1', label: 'Authentication, roles & permissions, secure API', done: true },
  { phase: 'Phase 2', label: 'Customers and staff management', done: false },
  { phase: 'Phase 3', label: 'Loan products and loan creation', done: false },
  { phase: 'Phase 4', label: 'Loan calculation engine and repayment schedules', done: false },
  { phase: 'Phase 5', label: 'Transaction ledger and repayments', done: false },
  { phase: 'Phase 6', label: 'Top-ups', done: false },
  { phase: 'Phase 7', label: 'Reports and live dashboards', done: false },
  { phase: 'Phase 8', label: 'Audit log viewer and settings', done: false },
]

/** Role dashboards share this shell until Phase 7 supplies real, database-driven metrics. */
export default function DashboardPage({ variant }: { variant: 'ceo' | 'accountant' }) {
  const { user } = useAuth()
  if (!user) return null
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greet}, {user.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">{variant === 'ceo' ? 'Executive overview' : 'Daily operations'} · financial metrics appear here once loan data is recorded.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="font-semibold">Build progress</h2>
          <ul className="mt-4 space-y-3">
            {roadmap.map((r) => (
              <li key={r.phase} className="flex items-center gap-3 text-sm">
                {r.done ? <CheckCircle2 className="size-5 text-brand-600" /> : <Circle className="size-5 text-slate-300" />}
                <span className="w-16 font-medium text-slate-500">{r.phase}</span><span className={r.done ? '' : 'text-slate-500'}>{r.label}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Your access</h2>
          <p className="mt-1 text-sm text-slate-500">Granted by the CEO and enforced by the server.</p>
          <div className="mt-4 flex flex-wrap gap-1.5">{user.permissions.map((p) => <Badge key={p} tone="green">{p}</Badge>)}</div>
        </section>
      </div>
    </div>
  )
}
