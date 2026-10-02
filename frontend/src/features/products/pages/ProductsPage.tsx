import { useMemo, useState } from 'react'
import { Package, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useAsync } from '../../../hooks/useAsync'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Modal'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { formatMoneyShort, titleCase } from '../../../utils/format'
import type { Product } from '../../../types/finance'
import { productService } from '../../settings/services/settingsService'
import { DEFAULT_CATEGORIES, ProductModal } from '../components/ProductModal'


export default function ProductsPage() {
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => productService.list(), [])
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)

  const categories = useMemo(() => [...new Set((data ?? []).map((p) => p.category ?? 'General'))].sort(), [data])
  const suggestions = useMemo(() => [...new Set([...DEFAULT_CATEGORIES, ...categories])], [categories])
  const shown = (data ?? []).filter((p) => !category || (p.category ?? 'General') === category)
  const groups = categories.filter((c) => !category || c === category).map((c) => ({ name: c, items: shown.filter((p) => (p.category ?? 'General') === c) }))

  async function toggleActive(p: Product) {
    try { await productService.update(p.id, { isActive: !p.isActive }); toast('success', p.isActive ? `${p.name} deactivated` : `${p.name} activated`); reload() }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not update product') }
  }
  async function remove() {
    if (!deleting) return
    setBusy(true)
    try { await productService.remove(deleting.id); toast('success', 'Product deleted'); reload() } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not delete') } finally { setBusy(false); setDeleting(null) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h1 className="text-2xl font-bold tracking-tight">Loan products</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Each product sets the interest rate, limits and repayment options for a type of loan. Changes apply to new loans only — existing loans keep the terms they were created with.</p></div>
        <Button onClick={() => setEditing('new')} className="px-5 py-3 text-base"><Plus className="size-5" />Add product</Button>
      </div>

      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Product categories">
          {['', ...categories].map((c) => (
            <button key={c || 'all'} role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${category === c ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-700'}`}>
              {c || 'All categories'}
            </button>
          ))}
        </div>
      )}

      {error ? <ErrorState message={error} onRetry={reload} /> : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full" />)}</div>
      ) : !data?.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white"><EmptyState icon={<Package className="size-6" />} title="No loan products yet" hint="Create your first product before creating loans — for example a salary advance at 5% per month." action={<Button onClick={() => setEditing('new')}><Plus className="size-4" />Add your first product</Button>} /></div>
      ) : groups.map((g) => (
        <section key={g.name} className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{g.name}<span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">{g.items.length}</span></h2>
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((p) => (
              <article key={p.id} className={`lift flex flex-col rounded-xl border bg-white p-5 shadow-sm ${p.isActive ? 'border-slate-200' : 'border-slate-200 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate font-semibold">{p.name}</h3><p className="font-mono text-xs text-slate-500">{p.code}</p></div>
                  <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                <p className="mt-4 text-3xl font-bold tracking-tight text-brand-700">{p.interestRate}%<span className="ml-1 text-sm font-medium text-slate-500">{p.rateBasis === 'per_month' ? 'per month' : p.rateBasis === 'per_annum' ? 'per annum' : 'flat'}</span></p>
                {p.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{p.description}</p>}
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div><dt className="text-slate-500">Amount</dt><dd className="font-medium">{formatMoneyShort(p.minAmount)} – {p.maxAmount ? formatMoneyShort(p.maxAmount) : 'no limit'}</dd></div>
                  <div><dt className="text-slate-500">Duration</dt><dd className="font-medium">{p.minDuration}–{p.maxDuration ?? '∞'} {p.durationUnit}</dd></div>
                  <div><dt className="text-slate-500">Bank deduction</dt><dd className="font-medium">{p.bankDeductionRate}%</dd></div>
                  <div><dt className="text-slate-500">Repayment</dt><dd className="font-medium">{p.allowedFrequencies.map(titleCase).join(', ')}</dd></div>
                </dl>
                <div className="mt-5 flex items-center gap-1 border-t border-slate-100 pt-3">
                  <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setEditing(p)}><Pencil className="size-4" />Edit</Button>
                  <Button variant="ghost" className="!px-3 !py-1.5" onClick={() => toggleActive(p)}><Power className="size-4" />{p.isActive ? 'Deactivate' : 'Activate'}</Button>
                  <Button variant="ghost" className="ml-auto !px-2.5 !py-1.5 text-red-600" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><Trash2 className="size-4" /></Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {editing && <ProductModal product={editing === 'new' ? null : editing} categories={suggestions} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} danger loading={busy} title="Delete loan product?" confirmLabel="Delete product" message={`${deleting?.name} will be removed. Products used by existing loans cannot be deleted — deactivate them instead.`} onConfirm={remove} onCancel={() => setDeleting(null)} />
    </div>
  )
}
