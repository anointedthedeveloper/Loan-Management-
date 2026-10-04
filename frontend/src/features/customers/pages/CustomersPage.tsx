import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useDebounce } from '../../../hooks/useDebounce'
import { ApiError, type Pagination as P } from '../../../services/api'
import { Button } from '../../../components/ui/Button'
import { ImportCustomersModal } from '../components/ImportCustomersModal'
import { ConfirmDialog } from '../../../components/ui/Modal'
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { Pagination } from '../../../components/ui/Pagination'
import { formatDate } from '../../../utils/format'
import { customerService } from '../services/customerService'
import { useCustomerMeta } from '../hooks/useCustomerMeta'
import { CustomerFilters, type Filters } from '../components/CustomerFilters'
import { CustomerStatusBadge } from '../components/CustomerStatusBadge'
import type { Customer } from '../types'

const columns: { key: string; label: string; sortable?: boolean; hide?: boolean }[] = [
  { key: 'customerId', label: 'Customer ID', sortable: true },
  { key: 'fullName', label: 'Name', sortable: true },
  { key: 'ippis', label: 'IPPIS no.', hide: true },
  { key: 'phone', label: 'Phone', hide: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'registrationDate', label: 'Registered', sortable: true, hide: true },
]

export default function CustomersPage() {
  const { can } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const meta = useCustomerMeta()
  const [search] = useSearchParams()
  const [filters, setFilters] = useState<Filters>({ q: '', status: '', from: '', to: '', profile: search.get('profile') ?? '' })
  const [importing, setImporting] = useState(false)
  const [sort, setSort] = useState({ key: 'fullName', order: 'asc' as 'asc' | 'desc' })
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Customer[] | null>(null)
  const [pg, setPg] = useState<P | null>(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [deleting, setDeleting] = useState<Customer | null>(null)
  const [busy, setBusy] = useState(false)
  const q = useDebounce(filters.q)

  useEffect(() => {
    let live = true
    setError('')
    customerService.list({ q: q || undefined, status: filters.status || undefined, from: filters.from || undefined, to: filters.to || undefined, profile: filters.profile || undefined, sort: sort.key, order: sort.order, page, limit: 15 })
      .then((r) => { if (live) { setRows(r.data); setPg(r.pagination) } })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : 'Unexpected error') })
    return () => { live = false }
  }, [q, filters.status, filters.from, filters.to, filters.profile, sort, page, reloadKey])

  const changeFilters = (f: Filters) => { setFilters(f); setPage(1) }
  const toggleSort = (key: string) => { setSort((s) => ({ key, order: s.key === key && s.order === 'asc' ? 'desc' : 'asc' })); setPage(1) }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try { await customerService.remove(deleting.id); toast('success', `${deleting.fullName} deleted`); setDeleting(null); setReloadKey((k) => k + 1) }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not delete customer'); setDeleting(null) }
    finally { setBusy(false) }
  }

  const filtered = !!(filters.q || filters.status || filters.from || filters.to || filters.profile)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Customers</h1><p className="text-sm text-slate-500">Register and manage Protech borrowers.</p></div>
        <div className="flex flex-wrap gap-2">
          {can(PERM.customers.import) && <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="size-4" />Import from Excel</Button>}
          {can(PERM.customers.create) && <Link to="/customers/new"><Button><Plus className="size-4" />Add customer</Button></Link>}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <CustomerFilters value={filters} meta={meta} onChange={changeFilters} />
        {error ? <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} /> : !rows ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />} title={filtered ? 'No customers match your search' : 'No customers yet'}
            hint={filtered ? 'Try a different name, phone number or ID, or clear the filters.' : 'Register your first customer to get started.'}
            action={!filtered && can(PERM.customers.create) ? <Link to="/customers/new"><Button><Plus className="size-4" />Add customer</Button></Link> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={`px-4 py-3 ${c.hide ? 'hidden md:table-cell' : ''}`} aria-sort={sort.key === c.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sortable ? <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink">{c.label}{sort.key === c.key && (sort.order === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button> : c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => nav(`/customers/${c.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{c.customerId}</td>
                    <td className="px-4 py-3"><p className="font-medium">{c.fullName}{c.profile && !c.profile.complete && <span title={`Missing: ${c.profile.missing.join(', ')}`} className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-800">Incomplete · {c.profile.missing.length}</span>}</p>{c.email && <p className="text-xs text-slate-500">{c.email}</p>}</td>
                    <td className="hidden px-4 py-3 font-mono text-xs md:table-cell">{c.employment?.ippisNumber ?? <span className="font-sans text-slate-400">{c.employment?.sector === 'non_government' ? 'Non-govt' : '—'}</span>}</td>
                    <td className="hidden px-4 py-3 md:table-cell">{c.phone}</td>
                    <td className="px-4 py-3"><CustomerStatusBadge status={c.status} /></td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{formatDate(c.registrationDate)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Link to={`/customers/${c.id}`} aria-label={`View ${c.fullName}`} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><Eye className="size-4" /></Link>
                        {can(PERM.customers.update) && <Link to={`/customers/${c.id}/edit`} aria-label={`Edit ${c.fullName}`} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><Pencil className="size-4" /></Link>}
                        {can(PERM.customers.delete) && <button onClick={() => setDeleting(c)} aria-label={`Delete ${c.fullName}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="size-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pg && !error && <Pagination p={pg} onPage={setPage} />}
      </div>

      {importing && <ImportCustomersModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); setReloadKey((k) => k + 1) }} />}
      <ConfirmDialog open={!!deleting} danger loading={busy} title="Delete customer?" confirmLabel="Delete customer"
        message={`${deleting?.fullName} (${deleting?.customerId}) will be archived and removed from lists. Customers with loans or transactions cannot be deleted — set them to Inactive instead.`}
        onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
    </div>
  )
}
