import { useState, type FormEvent } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { MoneyField } from '../../../components/ui/MoneyField'
import { SelectField } from '../../../components/ui/FormControls'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import { formatMoney } from '../../../utils/format'
import { approvalService } from '../../approvals/approvalService'
import { repaymentService } from '../../repayments/services/repaymentService'
import type { Attachment, Transaction } from '../../../types/finance'
import { AttachmentGallery, AttachmentPicker } from '../../attachments/AttachmentComponents'

/** Corrects a recorded repayment. The ledger keeps both entries (the original is reversed, a replacement is posted) and the reason is audited. */
export function EditRepaymentModal({ tx, onClose, onDone, asRequest }: { tx: Transaction; onClose: () => void; onDone: () => void; asRequest?: boolean }) {
  const toast = useToast()
  const meta = useLoanMeta()
  const [f, setF] = useState({ amount: String(tx.amount), date: tx.date.slice(0, 10), method: tx.method ?? '', reference: tx.reference ?? '', description: tx.description ?? '', reason: '' })
  const [added, setAdded] = useState<Attachment[]>([])
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })) }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!Number(f.amount)) return setErrs({ amount: 'Enter the amount paid' })
    if (f.reason.trim().length < 3) return setErrs({ reason: 'Enter the reason for the change' })
    setBusy(true); setErrs({})
    try {
      if (asRequest) { await approvalService.request('repayment_edit', tx.id, f.reason, { amount: Number(f.amount), date: f.date || undefined, method: f.method || undefined, reference: f.reference || undefined, description: f.description || undefined, attachmentIds: added.length ? added.map((a) => a.id) : undefined }); toast('success', 'Sent to the CEO for approval'); return onDone() }
      await repaymentService.edit(tx.id, { amount: Number(f.amount), date: f.date || undefined, method: f.method || undefined, reference: f.reference || undefined, description: f.description || undefined, reason: f.reason, attachmentIds: added.length ? added.map((a) => a.id) : undefined })
      toast('success', 'Repayment updated'); onDone()
    } catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not update the repayment') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`${asRequest ? 'Request correction of' : 'Edit repayment'} ${tx.transactionId}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Recorded as <b className="tabular-nums">{formatMoney(tx.amount)}</b>{tx.loan?.loanId ? <> on <b>{tx.loan.loanId}</b></> : null}. Balances and the schedule are recalculated from the ledger.</p>
        <MoneyField label="Amount paid" autoFocus value={f.amount} onChange={(v) => { setF((s) => ({ ...s, amount: v })); setErrs((x) => ({ ...x, amount: '' })) }} error={errs.amount} placeholder="0.00" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment date" type="date" value={f.date} onChange={set('date')} error={errs.date} />
          <SelectField label="Method" options={meta?.paymentMethods ?? []} value={f.method} onChange={set('method')} placeholder="Choose method" error={errs.method} />
        </div>
        <Field label="Reference" value={f.reference} onChange={set('reference')} error={errs.reference} />
        <Field label="Note" value={f.description} onChange={set('description')} />
        {tx.attachments?.length ? <div><p className="mb-1.5 text-sm font-medium text-slate-700">Files already attached</p><AttachmentGallery files={tx.attachments} /></div> : null}
        <AttachmentPicker value={added} onChange={setAdded} loanId={tx.loan?.id} label="Add more proof of payment" />
        <Field label="Reason for the change *" value={f.reason} onChange={set('reason')} error={errs.reason} placeholder="e.g. Amount typed wrongly" />
        {asRequest && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Nothing changes yet. The CEO reviews this request and the correction is made once approved.</p>}
        <p className="text-xs text-slate-500">The original entry is reversed and a corrected one is posted. Both stay in the ledger and the change is recorded in the audit log.</p>
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…">{asRequest ? 'Send for approval' : 'Save changes'}</Button></ModalActions>
      </form>
    </Modal>
  )
}
