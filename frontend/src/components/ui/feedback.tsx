import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { LogoMark } from './Logo'
import { Button } from './Button'

export const Skeleton = ({ className = '' }: { className?: string }) => <div className={`animate-pulse rounded bg-slate-200 ${className}`} />

export function LoadingScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-white">
      <LogoMark className="size-14 animate-pulse" />
      <p className="text-sm font-medium text-slate-500">Loading Protech portal…</p>
    </div>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>}
      <p className="font-semibold text-slate-800">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <EmptyState icon={<AlertTriangle className="size-6 text-red-500" />} title="We couldn't load this" hint={message} action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>} />
}

export function Badge({ tone = 'slate', children }: { tone?: 'green' | 'red' | 'amber' | 'slate' | 'blue'; children: ReactNode }) {
  const t = { green: 'bg-brand-50 text-brand-700 ring-brand-100', red: 'bg-red-50 text-red-700 ring-red-100', amber: 'bg-amber-50 text-amber-700 ring-amber-100', slate: 'bg-slate-100 text-slate-700 ring-slate-200', blue: 'bg-sky-50 text-sky-700 ring-sky-100' }[tone]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${t}`}>{children}</span>
}
