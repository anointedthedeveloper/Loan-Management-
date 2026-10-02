import { useState, type FormEvent } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { MoneyField } from '../../../components/ui/MoneyField'
import { SelectField, TextareaField } from '../../../components/ui/FormControls'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import type { Product } from '../../../types/finance'
import { productService } from '../../settings/services/settingsService'

export const DEFAULT_CATEGORIES = ['Salary advance', 'SME / Business', 'Personal', 'Daily trader', 'Asset finance', 'Other']

export function ProductModal({ product, categories, onClose, onDone }: { product: Product | null; categories: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const meta = useLoanMeta()
  const [f, setF] = useState({
    name: product?.name ?? '', code: product?.code ?? '', category: product?.category ?? '', description: product?.description ?? '', interestRate: String(product?.interestRate ?? ''), rateBasis: product?.rateBasis ?? 'per_month',
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
    const body = { ...f, category: f.category.trim() || 'General', interestRate: Number(f.interestRate), bankDeductionRate: Number(f.bankDeductionRate), minAmount: Number(f.minAmount), minDuration: Number(f.minDuration) }
    try { product ? await productService.update(product.id, body) : await productService.create(body); toast('success', product ? 'Product updated' : 'Product created'); onDone() }
    catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not save product') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={product ? `Edit ${product.name}` : 'Add loan product'} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" value={f.name} onChange={set('name')} error={errs.name} autoFocus /><Field label="Code" value={f.code} onChange={set('code')} error={errs.code} placeholder="e.g. SAL" />
          <div className="sm:col-span-2">
            <Field label="Category" list="product-categories" value={f.category} onChange={set('category')} error={errs.category} placeholder="Choose or type a category, e.g. Salary advance" />
            <p className="mt-1 text-xs text-slate-500">A label that groups similar products (for example <i>Salary advance</i> or <i>SME / Business</i>). It is used to organise and filter this list only — it does not change rates, limits or any loan rule.</p>
            <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="sm:col-span-2"><TextareaField label="Description" value={f.description} onChange={set('description')} /></div>
          <Field label="Interest rate (%)" type="number" step="0.01" min="0" value={f.interestRate} onChange={set('interestRate')} error={errs.interestRate} />
          <SelectField label="Rate basis" options={meta?.rateBases ?? []} value={f.rateBasis} onChange={set('rateBasis')} placeholder="Basis" />
          <Field label="Bank deduction (%)" type="number" step="0.01" min="0" value={f.bankDeductionRate} onChange={set('bankDeductionRate')} error={errs.bankDeductionRate} />
          <div />
          <MoneyField label="Minimum amount" value={f.minAmount} onChange={(v) => setF((s) => ({ ...s, minAmount: v }))} /><MoneyField label="Maximum amount" value={f.maxAmount} onChange={(v) => { setF((s) => ({ ...s, maxAmount: v })); setErrs((x) => ({ ...x, maxAmount: '' })) }} error={errs.maxAmount} placeholder="No maximum" />
          <Field label="Minimum duration" type="number" min="1" value={f.minDuration} onChange={set('minDuration')} /><Field label="Maximum duration" type="number" min="1" value={f.maxDuration} onChange={set('maxDuration')} error={errs.maxDuration} placeholder="No maximum" />
          <SelectField label="Duration unit" options={meta?.durationUnits ?? []} value={f.durationUnit} onChange={set('durationUnit')} placeholder="Unit" />
        </div>
        <fieldset><legend className="mb-2 text-sm font-medium text-slate-700">Allowed repayment frequencies</legend>
          <div className="flex flex-wrap gap-2">{(meta?.frequencies ?? []).map((o) => { const on = f.allowedFrequencies.includes(o.value); return <label key={o.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}><input type="checkbox" checked={on} onChange={() => toggleFreq(o.value)} className="accent-brand-700" />{o.label}</label> })}</div>
          {errs.allowedFrequencies && <p className="mt-1 text-xs text-red-600">{errs.allowedFrequencies}</p>}</fieldset>
        <SelectField label="Default frequency" options={(meta?.frequencies ?? []).filter((o) => f.allowedFrequencies.includes(o.value))} value={f.defaultFrequency} onChange={set('defaultFrequency')} error={errs.defaultFrequency} placeholder="Default" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF((s) => ({ ...s, isActive: e.target.checked }))} className="accent-brand-700" />Product is active (available for new loans)</label>
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…">{product ? 'Save changes' : 'Create product'}</Button></ModalActions>
      </form>
    </Modal>
  )
}
