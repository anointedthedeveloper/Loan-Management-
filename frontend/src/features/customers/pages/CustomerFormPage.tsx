import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../../../context/ToastContext'
import { ApiError } from '../../../services/api'
import { ErrorState, Skeleton } from '../../../components/ui/feedback'
import { clearDraft } from '../../../utils/draft'
import { customerService } from '../services/customerService'
import { useAsync } from '../../../hooks/useAsync'
import { useCustomerMeta } from '../hooks/useCustomerMeta'
import { CustomerForm } from '../components/CustomerForm'
import { emptyForm, fromCustomer, serverKeyToField, toPayload, type CustomerFormValues } from '../utils/form'

/** One page serves both /customers/new and /customers/:id/edit. */
export default function CustomerFormPage() {
  const { id } = useParams()
  const editing = !!id
  const nav = useNavigate()
  const toast = useToast()
  const meta = useCustomerMeta()
  const { data: existing, error, loading, reload } = useAsync(async () => (id ? customerService.get(id) : null), [id])
  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  async function submit(v: CustomerFormValues, original?: CustomerFormValues) {
    setBusy(true); setServerErrors({})
    try {
      const body = toPayload(v, original)
      const c = editing ? await customerService.update(id!, body) : await customerService.create(body)
      if (!editing) clearDraft('customer-new')
      toast('success', editing ? 'Customer updated' : `${c.fullName} registered as ${c.customerId}`)
      nav(`/customers/${c.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.fields) setServerErrors(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [serverKeyToField(k), m])))
      toast('error', e instanceof ApiError ? e.message : 'Could not save customer')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">{editing ? 'Edit customer' : 'Add customer'}</h1>
        <p className="text-sm text-slate-500">{editing ? existing?.customerId : 'A customer ID (PTC-######, continuing from the old client numbers) is generated automatically.'} Fields marked * are required.</p>
        {editing && existing?.profile && !existing.profile.complete && <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">This profile is incomplete. Still missing: <b>{existing.profile.missing.join(', ')}</b>. Fill in what you have and save; you can come back for the rest.</p>}</div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !meta || loading ? <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}</div> : (
        <CustomerForm meta={meta} initial={existing ? fromCustomer(existing) : emptyForm} submitLabel={editing ? 'Save changes' : 'Register customer'}
          busy={busy} serverErrors={serverErrors} draftKey={editing ? null : 'customer-new'} onSubmit={submit} onCancel={() => nav(editing ? `/customers/${id}` : '/customers')} />
      )}
    </div>
  )
}
