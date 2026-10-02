import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Pagination } from '../services/api'
import { useDebounce } from './useDebounce'

type Page<T> = { data: T[]; pagination: Pagination }
export type Filters = Record<string, string>

/** Server-side pagination, sorting and filtering in one hook; the browser never holds the full dataset. */
export function useServerList<T>(fetcher: (p: Record<string, string | number>) => Promise<Page<T>>, initial: Filters, defaultSort: { key: string; order: 'asc' | 'desc' }, limit = 15) {
  const [filters, setFilters] = useState<Filters>(initial)
  const [sort, setSort] = useState(defaultSort)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<T[] | null>(null)
  const [pg, setPg] = useState<Pagination | null>(null)
  const [error, setError] = useState('')
  const [key, setKey] = useState(0)
  const q = useDebounce(filters.q ?? '')

  useEffect(() => {
    let live = true
    setError('')
    const params: Record<string, string | number> = { sort: sort.key, order: sort.order, page, limit }
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = k === 'q' ? q : v
    if (!q) delete params.q
    fetcher(params).then((r) => { if (live) { setRows(r.data); setPg(r.pagination) } }).catch((e) => { if (live) setError(e instanceof ApiError ? e.message : 'Unexpected error') })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, JSON.stringify({ ...filters, q: '' }), sort, page, key])

  const updateFilters = useCallback((f: Filters) => { setFilters(f); setPage(1) }, [])
  const toggleSort = (k: string) => { setSort((s) => ({ key: k, order: s.key === k && s.order === 'asc' ? 'desc' : 'asc' })); setPage(1) }
  const reload = () => setKey((k) => k + 1)
  return { rows, pg, error, filters, updateFilters, sort, toggleSort, page, setPage, reload, filtered: Object.values(filters).some(Boolean) }
}
