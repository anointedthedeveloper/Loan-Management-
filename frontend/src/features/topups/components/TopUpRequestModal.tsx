import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useDebounce } from '../../../hooks/useDebounce'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { MoneyField } from '../../../components/ui/MoneyField'
import { useAuth } from '../../../context/AuthContext'
import { PERM } from '../../../config/permissions'
import { SelectField, TextareaField } from '../../../components/ui/FormControls'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import { LoanPicker, type Hit } from '../../../components/ui/Pickers'
import { formatDate, formatMoney } from '../../../utils/format'
import type { TopUpCalc } from '../../../types/finance'
import { topupService } from '../services/topupService'

export function TopUpCalculation({ c }: { c: TopUpCalc }) {
  const rows: [string, string][] = [
    ['Existing outstanding balance', formatMoney(c.existingOutstanding)], ['Repaid so far', `${c.percentRepaid}% of the existing loan`],
    ['New funds issued', formatMoney(c.newFunds)], ['Balance carried forward', formatMoney(c.carriedBalance)],
    ...(c.waivedOnExistingLoan > 0 ? [['Waived on existing loan', formatMoney(c.waivedOnExistingLoan)] as [string, string]] : []),
    ['New principal', formatMoney(c.terms.principal)], ['Additional interest', formatMoney(c.terms.interestAmount)],
  ]
  const q = c.liquidation
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      {q && (
        <div className="mb-2 space-y-1 rounded-lg border border-brand-200 bg-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Liquidating the old loan</p>
          {([['(a) Loan taken', formatMoney(q.loanTaken)], ['(b) Tenor used (revised)', `${q.revisedTenor} month${q.revisedTenor === 1 ? '' : 's'}`], ['(c) Revised total cost (principal + interest for that tenor)', formatMoney(q.revisedCost)], ['(d) Repaid to date', formatMoney(q.paidToDate)], ['(e) Outstanding balance (c − d)', formatMoney(q.outstanding)], [`(f) Liquidation fee (${q.feeRate}% of e)`, formatMoney(q.fee)]] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className="tabular-nums">{v}</span></div>)}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-1 font-semibold"><span>(g) Amount due on the old loan (e + f)</span><span className="tabular-nums">{formatMoney(q.amountDue)}</span></div>
        </div>
      )}
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Calculated by the server · {c.mode === 'consolidate' ? 'consolidates the existing balance into a new loan' : 'separate new loan'}</p>
      {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className="tabular-nums">{v}</span></div>)}
      <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 font-semibold"><span>New total repayment</span><span className="tabular-nums">{formatMoney(c.terms.totalRepayment)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-slate-500">{c.terms.numberOfInstallments} installments of</span><span className="tabular-nums">{formatMoney(c.terms.installmentAmount)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-slate-500">Final due date</span><span>{formatDate(c.terms.dueDate)}</span></div>
      {!c.eligible && <p className="rounded bg-red-50 p-2 text-red-700">{c.ineligibleReason}</p>}
    </div>
  )
}

export function TopUpRequestModal({ loan, onClose, onDone }: { loan?: { id: string; loanId: string; outstandingBalance: number; frequency?: string; duration?: { value: number; unit: string } }; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { can } = useAuth()
  const approver = can(PERM.topups.approve) // approvers (CEO) skip the approval step
  const meta = useLoanMeta()
  const [picked, setPicked] = useState<Hit | null>(loan ? { id: loan.id, title: loan.loanId, sub: `Outstanding ${formatMoney(loan.outstandingBalance)}` } : null)
  const [f, setF] = useState({ amount: '', durationValue: String(loan?.duration?.value ?? 6), durationUnit: loan?.duration?.unit ?? 'months', revisedTenor: '', frequency: loan?.frequency ?? 'monthly', customIntervalDays: '', interestRate: '', notes: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [calc, setCalc] = useState<TopUpCalc | null>(null)
  const [calcErr, setCalcErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })) }
  const body = () => ({ loanId: picked?.id, amount: Number(f.amount), duration: { value: Number(f.durationValue), unit: f.durationUnit }, frequency: f.frequency, customIntervalDays: f.customIntervalDays ? Number(f.customIntervalDays) : undefined, interestRate: f.interestRate ? Number(f.interestRate) : undefined, revisedTenor: f.revisedTenor ? Number(f.revisedTenor) : undefined })
  const key = useDebounce(JSON.stringify(body()), 500)
  useEffect(() => {
    const b = JSON.parse(key)
    if (!b.loanId || !(b.amount > 0) || !b.duration.value) { setCalc(null); setCalcErr(''); return }
    let live = true
    topupService.preview(b).then((c) => { if (live) { setCalc(c); setCalcErr('') } }).catch((e) => { if (live) { setCalc(null); setCalcErr(e instanceof ApiError ? e.message : 'Could not calculate') } })
    return () => { live = false }
  }, [key])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!picked) return setErrs({ loanId: 'Choose a loan' })
    setBusy(true)
    try { await topupService.request({ ...body(), notes: f.notes || undefined }); toast('success', approver ? 'Top-up created and approved' : 'Top-up submitted for approval'); onDone() }
    catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not request top-up') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Top-up" wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {loan ? <div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{loan.loanId}</b> · Outstanding {formatMoney(loan.outstandingBalance)}</div> : <LoanPicker value={picked} onChange={setPicked} error={errs.loanId} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="New funds requested" value={f.amount} onChange={(v) => { setF((s) => ({ ...s, amount: v })); setErrs((x) => ({ ...x, amount: '' })) }} error={errs.amount} placeholder="0.00" />
          <SelectField label="Repayment frequency" options={meta?.frequencies ?? []} value={f.frequency} onChange={set('frequency')} placeholder="Frequency" />
          <Field label="Duration" type="number" min="1" value={f.durationValue} onChange={set('durationValue')} />
          <SelectField label="Duration unit" options={meta?.durationUnits ?? []} value={f.durationUnit} onChange={set('durationUnit')} placeholder="Unit" />
          {f.frequency === 'custom' && <Field label="Interval (days)" type="number" min="1" value={f.customIntervalDays} onChange={set('customIntervalDays')} />}
          <Field label="Months the old loan was used (optional)" type="number" min="1" value={f.revisedTenor} onChange={set('revisedTenor')} placeholder="Worked out from the dates" />
          <Field label="Interest rate override (optional)" type="number" step="0.01" min="0" value={f.interestRate} onChange={set('interestRate')} placeholder="Defaults to the existing loan's rate" />
        </div>
        {calcErr ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{calcErr}</p> : calc ? <TopUpCalculation c={calc} /> : <p className="text-sm text-slate-500">Enter the amount to see how the top-up is calculated.</p>}
        <TextareaField label="Notes" value={f.notes} onChange={set('notes')} />
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…" disabled={!!calc && !calc.eligible}>{approver ? 'Create top-up' : 'Submit for approval'}</Button></ModalActions>
      </form>
    </Modal>
  )
}
