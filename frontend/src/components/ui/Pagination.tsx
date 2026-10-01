import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Pagination as P } from '../../services/api'

export function Pagination({ p, onPage }: { p: P; onPage: (n: number) => void }) {
  if (p.total === 0) return null
  const from = (p.page - 1) * p.limit + 1
  const to = Math.min(p.page * p.limit, p.total)
  const btn = 'inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>Showing <b>{from}–{to}</b> of <b>{p.total}</b></span>
      <div className="flex items-center gap-2">
        <button className={btn} disabled={p.page <= 1} onClick={() => onPage(p.page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
        <span>Page {p.page} of {p.pages}</span>
        <button className={btn} disabled={p.page >= p.pages} onClick={() => onPage(p.page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></button>
      </div>
    </div>
  )
}
