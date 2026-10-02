import { useState, type FormEvent } from 'react'
import { Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useAsync } from '../../../hooks/useAsync'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { SelectField, TextareaField } from '../../../components/ui/FormControls'
import { ConfirmDialog, Modal } from '../../../components/ui/Modal'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { formatMoney, titleCase } from '../../../utils/format'
import type { Product } from '../../../types/finance'
import { productService } from '../services/settingsService'

export function ProductsPanel() {
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => productService.list(), [])
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  async function remove() {
    if (!deleting) return
    setBusy(true)
    try { await productService.remove(deleting.id); toast('success', 'Product deleted'); reload() } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not delete') } finally { setBusy(false); setDeleting(null) }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h2 className="font-semibold">Loan products</h2><p className="text-sm text-slate-500">Rates, limits and repayment options. Changes apply to new loans only; existing loans keep their terms.</p></div><Button onClick={() => setEditing('new')}><Plus className="size-4" />Add product</Button></div>
      {error ? <ErrorState message={error} onRetry={reload} /> : loading ? <Skeleton className="h-32 w-full" /> : !data?.length ? <EmptyState icon={<Package className="size-6" />} title="No loan products yet" hint="Create a product before creating loans." /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Rate</th><th className="hidden px-4 py-3 md:table-cell">Limits</th><th className="hidden px-4 py-3 lg:table-cell">Frequencies</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.map((p) => (
            <tr key={p.id}><td className="px-4 py-3"><p className="font-medium">{p.name}</p><p className="font-mono text-xs text-slate-500">{p.code}</p></td>
              <td className="px-4 py-3">{p.interestRate}% <span className="text-xs text-slate-500">{p.rateBasis === 'per_month' ? 'per month' : p.rateBasis === 'per_annum' ? 'per annum' : 'flat'}</span>{p.bankDeductionRate > 0 && <p className="text-xs text-slate-500">{p.bankDeductionRate}% bank deduction</p>}</td>
              <td className="hidden px-4 py-3 text-xs md:table-cell">{formatMoney(p.minAmount)} – {p.maxAmount ? formatMoney(p.maxAmount) : 'no max'}<br />{p.minDuration}–{p.maxDuration ?? '∞'} {p.durationUnit}</td>
              <td className="hidden px-4 py-3 text-xs lg:table-cell">{p.allowedFrequencies.map(titleCase).join(', ')}</td>
              <td className="px-4 py-3"><Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></td>
              <td className="px-4 py-3 text-right"><div className="flex justify-end gap-1"><Button variant="ghost" className="!px-2.5 !py-1.5" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil className="size-4" /></Button><Button variant="ghost" className="!px-2.5 !py-1.5 text-red-600" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><Trash2 className="size-4" /></Button></div></td></tr>))}</tbody></table></div>
      )}
      {editing && <ProductModal product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} danger loading={busy} title="Delete loan product?" confirmLabel="Delete product" message={`${deleting?.name} will be removed. Products used by existing loans cannot be deleted — deactivate them instead.`} onConfirm={remove} onCancel={() => setDeleting(null)} />
    </div>
  )
}

function ProductModal({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const meta = useLoanMeta()
  const [f, setF] = useState({
    name: product?.name ?? '', code: product?.code ?? '', description: product?.description ?? '', interestRate: String(product?.interestRate ?? ''), rateBasis: product?.rateBasis ?? 'per_month',
    bankDeductionRate: String(product?.bankDeductionRate ?? 0), minAmount: String(product?.minAmount ?? 0), maxAmount: product?.maxAmount ? String(product.maxAmount) : '',
    minDuration: String(product?.minDuration ?? 1), maxDuration: product?.maxDuration ? String(product.maxDuration) : '', durationUnit: product?.durationUnit ?? 'months',
    allowedFrequencies: product?.allowedFrequencies ?? ['monthly'], defaultFrequency: product?.defaultFrequency ?? 'monthly', isActive: product?.isActive ?? true,
  })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })) }
  const toggleFreq = (v: string) => setF((s) => ({ ...s, allowedFrequencies: s.allowedFrequencies.includes(v) ? s.allowedFrequencies.filter((x) => x !== v) : [...s.allowedFrequencies, v] }))

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({})
    const body = { ...f, interestRate: Number(f.interestRate), bankDeductionRate: Number(f.bankDeductionRate), minAmount: Number(f.minAmount), minDuration: Number(f.minDuration) }
    try { product ? await productService.update(product.id, body) : await productService.create(body); toast('success', product ? 'Product updated' : 'Product created'); onDone() }
    catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not save product') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={product ? `Edit ${product.name}` : 'Add loan product'} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" value={f.name} onChange={set('name')} error={errs.name} autoFocus /><Field label="Code" value={f.code} onChange={set('code')} error={errs.code} placeholder="e.g. SAL" />
          <div className="sm:col-span-2"><TextareaField label="Description" value={f.description} onChange={set('description')} /></div>
          <Field label="Interest rate (%)" type="number" step="0.01" min="0" value={f.interestRate} onChange={set('interestRate')} error={errs.interestRate} />
          <SelectField label="Rate basis" options={meta?.rateBases ?? []} value={f.rateBasis} onChange={set('rateBasis')} placeholder="Basis" />
          <Field label="Bank deduction (%)" type="number" step="0.01" min="0" value={f.bankDeductionRate} onChange={set('bankDeductionRate')} error={errs.bankDeductionRate} />
          <div />
          <Field label="Minimum amount (₦)" type="number" min="0" value={f.minAmount} onChange={set('minAmount')} /><Field label="Maximum amount (₦)" type="number" min="0" value={f.maxAmount} onChange={set('maxAmount')} error={errs.maxAmount} placeholder="No maximum" />
          <Field label="Minimum duration" type="number" min="1" value={f.minDuration} onChange={set('minDuration')} /><Field label="Maximum duration" type="number" min="1" value={f.maxDuration} onChange={set('maxDuration')} error={errs.maxDuration} placeholder="No maximum" />
          <SelectField label="Duration unit" options={meta?.durationUnits ?? []} value={f.durationUnit} onChange={set('durationUnit')} placeholder="Unit" />
        </div>
        <fieldset><legend className="mb-2 text-sm font-medium text-slate-700">Allowed repayment frequencies</legend>
          <div className="flex flex-wrap gap-2">{(meta?.frequencies ?? []).map((o) => { const on = f.allowedFrequencies.includes(o.value); return <label key={o.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}><input type="checkbox" checked={on} onChange={() => toggleFreq(o.value)} className="accent-brand-700" />{o.label}</label> })}</div>
          {errs.allowedFrequencies && <p className="mt-1 text-xs text-red-600">{errs.allowedFrequencies}</p>}</fieldset>
        <SelectField label="Default frequency" options={(meta?.frequencies ?? []).filter((o) => f.allowedFrequencies.includes(o.value))} value={f.defaultFrequency} onChange={set('defaultFrequency')} error={errs.defaultFrequency} placeholder="Default" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF((s) => ({ ...s, isActive: e.target.checked }))} className="accent-brand-700" />Product is active (available for new loans)</label>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{product ? 'Save changes' : 'Create product'}</Button></div>
      </form>
    </Modal>
  )
}
