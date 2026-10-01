import type { ReactNode } from 'react'
import { Clock, Hourglass } from 'lucide-react'
import type { ActivityEntry, Tone } from '../../types'
import { Skeleton, EmptyState, Badge } from '../ui/feedback'
import { formatDateTime, humanizeAction } from '../../utils/format'

const card = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm'

/** A single real number from the API. */
export function MetricCard({ label, value, hint, icon, loading }: { label: string; value?: ReactNode; hint?: string; icon?: ReactNode; loading?: boolean }) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{label}</p>{icon && <span className="text-slate-400">{icon}</span>}</div>
      {loading ? <Skeleton className="mt-3 h-8 w-24" /> : <p className="mt-2 text-3xl font-bold tracking-tight">{value ?? '—'}</p>}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/** Money metric. Renders a placeholder until a real value is supplied — never a made-up number. */
export function FinancialMetricCard({ label, value, pendingText = 'Available once loans are recorded' }: { label: string; value?: number | null; pendingText?: string }) {
  const has = typeof value === 'number'
  return (
    <div className={card}>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      {has ? <p className="mt-2 text-3xl font-bold tracking-tight">{new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(value)}</p>
        : <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-400"><Hourglass className="size-4" />{pendingText}</p>}
    </div>
  )
}

export function StatusBreakdown({ title, items, loading }: { title: string; items?: { value: string; label: string; tone: Tone; count: number }[]; loading?: boolean }) {
  const total = items?.reduce((s, i) => s + i.count, 0) ?? 0
  const bar: Record<Tone, string> = { green: 'bg-brand-500', red: 'bg-red-500', amber: 'bg-amber-500', slate: 'bg-slate-400', blue: 'bg-sky-500' }
  return (
    <div className={card}>
      <h2 className="font-semibold">{title}</h2>
      {loading ? <Skeleton className="mt-4 h-24 w-full" /> : !items || total === 0 ? <p className="mt-4 text-sm text-slate-500">No records yet.</p> : (
        <ul className="mt-4 space-y-3">
          {items.map((i) => (
            <li key={i.value}>
              <div className="flex justify-between text-sm"><span>{i.label}</span><span className="font-medium">{i.count}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={`h-full rounded-full ${bar[i.tone]}`} style={{ width: `${(i.count / total) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ChartCard({ title, children, empty }: { title: string; children?: ReactNode; empty?: string }) {
  return (
    <div className={card}>
      <h2 className="font-semibold">{title}</h2>
      {children ?? <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{empty ?? 'Chart appears once data is available.'}</p>}
    </div>
  )
}

/** Audit-backed activity feed, reused on the dashboard, staff and customer pages. */
export function ActivityList({ items, loading, title, emptyText = 'No activity recorded yet.', showDetails }: { items?: ActivityEntry[]; loading?: boolean; title?: string; emptyText?: string; showDetails?: boolean }) {
  return (
    <div className={title ? card : ''}>
      {title && <h2 className="font-semibold">{title}</h2>}
      {loading ? <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : !items?.length ? <EmptyState icon={<Clock className="size-6" />} title={emptyText} />
        : (
          <ul className={`${title ? 'mt-4' : ''} divide-y divide-slate-100`}>
            {items.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{humanizeAction(a.action)}{a.entityLabel && <span className="ml-1.5 font-normal text-slate-500">· {a.entityLabel}</span>}</p>
                  <p className="text-xs text-slate-500">{a.userName ?? 'System'} · {formatDateTime(a.createdAt)}</p>
                  {showDetails && a.after && <ChangeSummary before={a.before} after={a.after} />}
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

function ChangeSummary({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> }) {
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? (v.length === 0 ? '—' : v.length > 4 ? `${v.length} items` : v.join(', ')) : typeof v === 'object' ? 'updated' : String(v))
  const rows = Object.keys(after).filter((k) => !['id', 'lastLoginAt', 'createdAt', 'updatedAt'].includes(k)).slice(0, 6)
  if (!rows.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {rows.map((k) => <Badge key={k}>{k}: {before && k in before ? `${show(before[k])} → ` : ''}{show(after[k])}</Badge>)}
    </div>
  )
}
