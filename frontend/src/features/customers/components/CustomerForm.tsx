import { useEffect, useState, type FormEvent } from 'react'
import { Briefcase, Building2, Check, FileClock } from 'lucide-react'
import { useDraft } from '../../../hooks/useDraft'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { FormSection, SelectField, TextareaField } from '../../../components/ui/FormControls'
import type { CustomerMeta } from '../types'
import { quickValidate, type CustomerFormValues } from '../utils/form'

interface Props {
  meta: CustomerMeta
  initial: CustomerFormValues
  submitLabel: string
  busy: boolean
  serverErrors: Record<string, string>
  /** When set, unsaved input is autosaved in this browser under this key (new customers only). */
  draftKey?: string | null
  onSubmit: (v: CustomerFormValues, original?: CustomerFormValues) => void
  onCancel: () => void
}

export function CustomerForm({ meta, initial, submitLabel, busy, serverErrors, draftKey = null, onSubmit, onCancel }: Props) {
  const [v, setV] = useState(initial)
  const draft = useDraft<CustomerFormValues>(draftKey, v, (x) => JSON.stringify(x) === JSON.stringify(initial))
  useEffect(() => { const d = draft.load(); if (d) { setV({ ...initial, ...d.data }); draft.markRestored(d.savedAt) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const original = draftKey ? undefined : initial // editing an existing profile: details that were never filled in are not forced
  const [local, setLocal] = useState<Record<string, string>>({})
  const err = (k: string) => local[k] ?? serverErrors[k]
  const set = (k: keyof CustomerFormValues) => (e: { target: { value: string } }) => { setV((s) => ({ ...s, [k]: e.target.value })); setLocal((l) => ({ ...l, [k]: '' })) }
  const text = (k: keyof CustomerFormValues, label: string, extra: object = {}) => <Field label={label} value={v[k]} onChange={set(k)} error={err(k)} {...extra} />

  function submit(e: FormEvent) {
    e.preventDefault()
    const errors = quickValidate(v, original)
    setLocal(errors)
    if (Object.keys(errors).length) { document.getElementById('customer-form')?.querySelector('[aria-invalid=true]')?.scrollIntoView({ block: 'center' }); return }
    onSubmit(v, original)
  }

  return (
    <form id="customer-form" onSubmit={submit} noValidate className="space-y-5">
      {draft.restoredAt && (
        <div className="flex animate-fade-in flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-2"><FileClock className="size-4" />Restored your unsaved draft from {new Date(draft.restoredAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.</span>
          <button type="button" className="font-medium underline" onClick={() => { draft.discard(); setV(initial); setLocal({}) }}>Discard draft</button>
        </div>
      )}
      <FormSection title="Type of worker" description="Choose first. Government workers are identified by their IPPIS number (one customer per IPPIS number) and the ministry they work in; for non-government workers, enter the organisation they work for.">
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2" role="radiogroup" aria-label="Type of worker">
          {([['government', 'Government worker', 'Paid through IPPIS: needs an IPPIS number and a ministry.', Building2], ['non_government', 'Non-government worker', 'No IPPIS number. Enter the organisation or employer.', Briefcase]] as const).map(([val, title, hint, Icon]) => (
            <button key={val} type="button" role="radio" aria-checked={v.sector === val} onClick={() => { setV((s) => ({ ...s, sector: val })); setLocal((l) => ({ ...l, sector: '' })) }}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${v.sector === val ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 bg-white hover:border-brand-400'}`}>
              <Icon className={`mt-0.5 size-5 ${v.sector === val ? 'text-brand-700' : 'text-slate-400'}`} />
              <span><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs text-slate-500">{hint}</span></span>
            </button>
          ))}
        </div>
        {err('sector') && <p className="text-xs text-red-600 sm:col-span-2" role="alert">{err('sector')}</p>}
        {v.sector === 'government' && <>
          {text('ippisNumber', 'IPPIS number *')}
          {text('ministry', 'Ministry / department *')}
        </>}
        {v.sector === 'non_government' && <div className="sm:col-span-2">{text('ministry', 'Organisation / employer')}</div>}
      </FormSection>

      <FormSection title="Personal details">
        {text('firstName', 'First name *', { autoFocus: true })}
        {text('middleName', 'Middle name')}
        {text('lastName', 'Last name *')}
        {text('dateOfBirth', 'Date of birth *', { type: 'date' })}
        <SelectField label="Gender *" options={meta.genders} value={v.gender} onChange={set('gender')} error={err('gender')} />
        <SelectField label="Marital status *" options={meta.maritalStatuses ?? []} value={v.maritalStatus} onChange={set('maritalStatus')} error={err('maritalStatus')} />
        <SelectField label="Status" options={meta.statuses} value={v.status} onChange={set('status')} error={err('status')} placeholder="Choose status" />
      </FormSection>

      <FormSection title="Contact">
        {text('phone', 'Phone number *', { type: 'tel', placeholder: '0803 123 4567' })}
        {text('altPhone', 'Alternative phone', { type: 'tel' })}
        {text('email', 'Email *', { type: 'email', placeholder: 'Email address' })}
        <div className="sm:col-span-2">{text('address', 'Residential address *')}</div>
        {text('state', 'State *')}
        {text('lga', 'Local government area (LGA)')}
      </FormSection>

      <FormSection title="Identification" description="Both are required: 11 digits each. A NIN or BVN can be registered to one customer only.">
        {text('nin', 'NIN (National Identification Number) *', { inputMode: 'numeric', maxLength: 11 })}
        {text('bvn', 'BVN (Bank Verification Number) *', { inputMode: 'numeric', maxLength: 11 })}
      </FormSection>

      <FormSection title="Occupation">
        {text('occupation', 'Occupation / job title')}
      </FormSection>

      <FormSection title="Emergency contact">
        {text('ecName', 'Contact name *')}
        {text('ecRelationship', 'Relationship')}
        {text('ecPhone', 'Contact phone *', { type: 'tel' })}
      </FormSection>

      <FormSection title="Records" description="Client number from Protech's previous loan book, if this customer already existed there.">
        {text('legacyId', 'Previous client number')}
      </FormSection>

      <FormSection title="Notes">
        <div className="sm:col-span-2"><TextareaField label="Internal notes" value={v.notes} onChange={set('notes')} error={err('notes')} /></div>
      </FormSection>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-surface/95 px-4 py-3 sm:-mx-6 sm:px-6">
        {draftKey && draft.savedAt && <span className="mr-auto flex animate-fade-in items-center gap-1.5 text-xs text-slate-500"><Check className="size-3.5 text-brand-600" />Draft saved</span>}
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy} loadingText={draftKey ? 'Registering…' : 'Saving…'}>{submitLabel}</Button>
      </div>
    </form>
  )
}
