import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Pagination as P } from '../../services/api'
import { ErrorState, Skeleton } from './feedback'
import { Pagination } from './Pagination'

export interface Column<T> {
  key: string; label: string; render: (row: T) => ReactNode
  sortKey?: string; align?: 'right'; hideBelow?: 'md' | 'lg'
}

/** Professional data table: skeleton loading, empty/error states, sortable headers, pagination, responsive columns. */
export function DataTable<T extends { id: string }>({ columns, rows, pg, error, onRetry, sort, onSort, onPage, onRowClick, empty, toolbar, footer }: {
  columns: Column<T>[]; rows: T[] | null; pg: P | null; error?: string; onRetry?: () => void
  sort?: { key: string; order: 'asc' | 'desc' }; onSort?: (k: string) => void; onPage?: (n: number) => void
  onRowClick?: (r: T) => void; empty: ReactNode; toolbar?: ReactNode; footer?: ReactNode
}) {
  const hide = (c: Column<T>) => (c.hideBelow === 'md' ? 'hidden md:table-cell' : c.hideBelow === 'lg' ? 'hidden lg:table-cell' : '')
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {toolbar}
      {error ? <ErrorState message={error} onRetry={onRetry} /> : !rows ? (
        <div className="space-y-3 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : rows.length === 0 ? empty : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : ''} ${hide(c)}`} aria-sort={c.sortKey && sort?.key === c.sortKey ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortKey && onSort ? <button onClick={() => onSort(c.sortKey!)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink">{c.label}{sort?.key === c.sortKey && (sort.order === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button> : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}>
                  {columns.map((c) => <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${hide(c)}`}>{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer}
      {pg && !error && onPage && <Pagination p={pg} onPage={onPage} />}
    </div>
  )
}
