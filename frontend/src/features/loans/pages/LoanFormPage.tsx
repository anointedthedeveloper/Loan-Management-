import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Calculator, Check, FileClock } from 'lucide-react'
import { useDraft } from '../../../hooks/useDraft'
import { clearDraft } from '../../../utils/draft'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useAsync } from '../../../hooks/useAsync'
import { useDebounce } from '../../../hooks/useDebounce'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { MoneyField } from '../../../components/ui/MoneyField'
import { useAuth } from '../../../context/AuthContext'
import { PERM } from '../../../config/permissions'
import { FormSection, SelectField, TextareaField } from '../../../components/ui/FormControls'
import { ErrorState, Skeleton } from '../../../components/ui/feedback'
import { CustomerPicker, type Hit } from '../../../components/ui/Pickers'
import { formatDate, formatMoney, titleCase } from '../../../utils/format'
import type { LoanPreview } from '../../../types/finance'
import { loanService } from '../services/loanService'
import { customerService } from '../../customers/services/customerService'
import { ScheduleTable } from '../components/ScheduleTable'

const todayStr = () => new Date().toISOString().slice(0, 10)

/** New / edit loan. Every figure in the right-hand panel is calculated by the backend engine via /loans/preview. */
export default function LoanFormPage() {
  const { id } = useParams()
  const editing = !!id
  const nav = useNavigate()
  const [search] = useSearchParams()
  const toast = useToast()
  const { can } = useAuth()
  const approver = can(PERM.loans.approve) // approvers (CEO) skip the approval step
  const meta = useLoanMeta()
  const products = useAsync(() => loanService.products(), [])
  const existing = useAsync(async () => (id ? loanService.get(id) : null), [id])
  const [customer, setCustomer] = useState<Hit | null>(null)
  const [f, setF] = useState({ productId: '', amount: '', durationValue: '', durationUnit: 'months', frequency: '', customIntervalDays: '', numberOfInstallments: '', startDate: todayStr(), firstPaymentDate: '', notes: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<LoanPreview | null>(null)
  const [previewErr, setPreviewErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })) }
  const product = products.data?.find((p) => p.id === f.productId)
  const draft = useDraft(editing ? null : 'loan-new', { f, customer }, (x) => !x.customer && !x.f.amount && !x.f.productId)
  useEffect(() => { // bring back an unsaved draft (a ?customer= link still wins for the customer)
    if (editing) return
    const d = draft.load()
    if (d) { setF(d.data.f); setCustomer(d.data.customer); draft.markRestored(d.savedAt) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // arriving from a customer page: preselect that customer
    const cid = search.get('customer')
    if (cid && !id) customerService.get(cid).then((c) => setCustomer({ id: c.id, title: c.fullName, sub: `${c.customerId} · ${c.phone}` })).catch(() => undefined)
  }, [search, id])
  useEffect(() => { // prefill when editing
    const l = existing.data?.loan
    if (!l) return
    setCustomer({ id: l.customer.id, title: l.customer.fullName ?? '', sub: l.customer.customerId ?? '' })
    setF({ productId: l.product ?? '', amount: String(l.amount), durationValue: String(l.duration.value), durationUnit: l.duration.unit, frequency: l.frequency, customIntervalDays: l.customIntervalDays ? String(l.customIntervalDays) : '', numberOfInstallments: '', startDate: l.startDate.slice(0, 10), firstPaymentDate: l.firstPaymentDateIsCustom && l.firstPaymentDate ? l.firstPaymentDate.slice(0, 10) : '', notes: l.notes ?? '' })
  }, [existing.data])
  useEffect(() => { // product defaults when a product is chosen
    if (!product || editing) return
    setF((s) => ({ ...s, durationUnit: product.durationUnit, durationValue: s.durationValue || String(product.minDuration), frequency: product.allowedFrequencies.includes(s.frequency) ? s.frequency : product.defaultFrequency }))
  }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(() => ({
    productId: f.productId, amount: Number(f.amount), startDate: f.startDate, firstPaymentDate: f.firstPaymentDate || undefined, frequency: f.frequency || undefined,
    duration: f.durationValue ? { value: Number(f.durationValue), unit: f.durationUnit } : undefined,
    customIntervalDays: f.customIntervalDays ? Number(f.customIntervalDays) : undefined, numberOfInstallments: f.numberOfInstallments ? Number(f.numberOfInstallments) : undefined,
  }), [f])
  const dBody = useDebounce(JSON.stringify(body), 500)
  useEffect(() => {
    const b = JSON.parse(dBody)
    if (!b.productId || !(b.amount > 0) || !b.startDate) { setPreview(null); setPreviewErr(''); return }
    let live = true
    loanService.preview(b).then((p) => { if (live) { setPreview(p); setPreviewErr('') } }).catch((e) => { if (live) { setPreview(null); setPreviewErr(e instanceof ApiError ? e.message : 'Could not calculate') } })
    return () => { live = false }
  }, [dBody])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const v: Record<string, string> = {}
    if (!editing && !customer) v.customerId = 'Choose a customer'
    if (!f.productId) v.productId = 'Choose a loan product'
    if (!(Number(f.amount) > 0)) v.amount = 'Enter the loan amount'
    setErrs(v); if (Object.keys(v).length) return
    setBusy(true)
    try {
      const d = editing ? await loanService.update(id!, body) : await loanService.create({ ...body, customerId: customer!.id, notes: f.notes || undefined })
      if (!editing) clearDraft('loan-new')
      toast('success', editing ? 'Loan updated' : d.loan.status === 'pending' ? `Loan ${d.loan.loanId} submitted for approval` : `Loan ${d.loan.loanId} created and approved`); nav(`/loans/${d.loan.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrs(err.fields)
      toast('error', err instanceof ApiError ? err.message : 'Could not save loan')
    } finally { setBusy(false) }
  }

  if (existing.error) return <ErrorState message={existing.error} onRetry={existing.reload} />
  if (editing && existing.loading) return <Skeleton className="h-96 w-full" />
  const freqOptions = (meta?.frequencies ?? []).filter((x) => !product || product.allowedFrequencies.includes(x.value))
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">{editing ? `Edit ${existing.data?.loan.loanId}` : 'New loan'}</h1>
        <p className="text-sm text-slate-500">{approver ? 'Loans you create are approved and disbursed straight away.' : 'New loans are submitted to the CEO for approval.'} Interest, totals and the schedule are calculated by the server.</p></div>
      {draft.restoredAt && !editing && (
        <div className="flex animate-fade-in flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-2"><FileClock className="size-4" />Restored your unsaved draft from {new Date(draft.restoredAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.</span>
          <button type="button" className="font-medium underline" onClick={() => { draft.discard(); setCustomer(null); setF({ productId: '', amount: '', durationValue: '', durationUnit: 'months', frequency: '', customIntervalDays: '', numberOfInstallments: '', startDate: todayStr(), firstPaymentDate: '', notes: '' }) }}>Discard draft</button>
        </div>
      )}
      <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <FormSection title="Borrower and product">
            <div className="sm:col-span-2">{editing ? <p className="rounded-lg bg-slate-50 p-3 text-sm"><b>{customer?.title}</b> {customer?.sub}</p> : <CustomerPicker value={customer} onChange={(h) => { setCustomer(h); setErrs((x) => ({ ...x, customerId: '' })) }} error={errs.customerId} />}</div>
            <div className="sm:col-span-2"><SelectField label="Loan product" options={(products.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.name} — ${p.interestRate}% ${p.rateBasis === 'per_month' ? 'per month' : p.rateBasis === 'per_annum' ? 'per annum' : 'flat'}` }))} value={f.productId} onChange={set('productId')} error={errs.productId} placeholder="Choose product" /></div>
          </FormSection>
          <FormSection title="Terms">
            <MoneyField label="Loan amount received by customer" value={f.amount} onChange={(v) => { setF((s) => ({ ...s, amount: v })); setErrs((x) => ({ ...x, amount: '' })) }} error={errs.amount} placeholder="0.00" />
            <Field label="Start date" type="date" value={f.startDate} onChange={set('startDate')} error={errs.startDate} />
            <Field label="Duration" type="number" min="1" value={f.durationValue} onChange={set('durationValue')} error={errs.duration} />
            <SelectField label="Duration unit" options={meta?.durationUnits ?? []} value={f.durationUnit} onChange={set('durationUnit')} placeholder="Unit" />
            <SelectField label="Repayment frequency" options={freqOptions} value={f.frequency} onChange={set('frequency')} error={errs.frequency} placeholder="Product default" />
            {f.frequency === 'custom' && <Field label="Interval (days)" type="number" min="1" value={f.customIntervalDays} onChange={set('customIntervalDays')} error={errs.customIntervalDays} />}
            <Field label="First payment date (optional)" type="date" value={f.firstPaymentDate} onChange={set('firstPaymentDate')} error={errs.firstPaymentDate} />
            <Field label="Number of installments (optional override)" type="number" min="1" value={f.numberOfInstallments} onChange={set('numberOfInstallments')} error={errs.numberOfInstallments} />
            {product && <p className="self-end text-xs text-slate-500 sm:col-span-2">Product limits: {product.minAmount ? formatMoney(product.minAmount) : '₦0'} – {product.maxAmount ? formatMoney(product.maxAmount) : 'no maximum'}, {product.minDuration}–{product.maxDuration ?? '∞'} {product.durationUnit}.</p>}
          </FormSection>
          {!editing && <FormSection title="Notes"><div className="sm:col-span-2"><TextareaField label="Internal notes" value={f.notes} onChange={set('notes')} /></div></FormSection>}
        </div>

        <aside className="lg:col-span-2">
          <div className="sticky top-4 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-semibold"><Calculator className="size-4 text-brand-600" />Calculation</h2>
            {previewErr ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{previewErr}</p> : !preview ? <p className="text-sm text-slate-500">Choose a product and enter an amount to see the repayment breakdown.</p> : (
              <>
                <dl className="space-y-2 text-sm">
                  {([['Amount received', preview.terms.amount], ...(preview.terms.bankDeductionRate ? [[`Gross payment (÷ ${(1 - preview.terms.bankDeductionRate / 100).toFixed(2)} for the ${preview.terms.bankDeductionRate}% bank deduction)`, preview.terms.grossAmount]] : []), ...(preview.terms.carriedBalance ? [['Balance brought forward', preview.terms.carriedBalance]] : []), ['Principal', preview.terms.principal], ['Monthly interest (principal × rate)', preview.terms.monthlyInterest], ['Interest (one-time, × tenor)', preview.terms.interestAmount]] as [string, number][]).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="tabular-nums">{formatMoney(v)}</dd></div>)}
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total repayment</dt><dd className="tabular-nums">{formatMoney(preview.terms.totalRepayment)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">{preview.terms.numberOfInstallments} × {titleCase(preview.frequency)}</dt><dd className="tabular-nums">{formatMoney(preview.terms.installmentAmount)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Final due date</dt><dd>{formatDate(preview.terms.dueDate)}</dd></div>
                </dl>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200"><ScheduleTable rows={preview.schedule} showPaid={false} compact /></div>
              </>
            )}
          </div>
        </aside>
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-surface/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:col-span-5">
          {!editing && draft.savedAt && <span className="mr-auto flex animate-fade-in items-center gap-1.5 text-xs text-slate-500"><Check className="size-3.5 text-brand-600" />Draft saved</span>}
          <Button type="button" variant="secondary" onClick={() => nav(-1)}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…">{editing ? 'Save changes' : approver ? 'Create loan' : 'Submit for approval'}</Button>
        </div>
      </form>
    </div>
  )
}
