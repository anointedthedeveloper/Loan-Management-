import { useState } from 'react'
import { Check, ClipboardCheck, X } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useAsync } from '../../../hooks/useAsync'
import { Button } from '../../../components/ui/Button'
import { ReasonDialog } from '../../../components/ui/ReasonDialog'
import { Pagination } from '../../../components/ui/Pagination'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { formatDateTime } from '../../../utils/format'
import { approvalService, type ApprovalRequest } from '../approvalService'

const TONE = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'slate' } as const
const KIND = { repayment_edit: 'Payment correction', transaction_reverse: 'Reversal', loan_edit: 'Loan change', loan_terminate: 'Early termination', customer_delete: 'Customer deletion' }

/** The CEO decides requests here; an accountant sees (and can cancel) their own. */
export default function ApprovalsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const decider = can(PERM.approvals.decide)
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null)
  const [busy, setBusy] = useState('')
  const q = useAsync(() => approvalService.list({ status, page, limit: 20 }), [status, page])
  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id)
    try { await fn(); toast('success', ok); q.reload() } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not complete that') } finally { setBusy(''); setRejecting(null) }
  }
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">Approvals</h1><p className="text-sm text-slate-500">{decider ? 'Changes staff asked for. Nothing changes until you approve.' : 'Changes you asked the CEO to approve.'}</p></div>
      <div className="flex gap-2">{['pending', 'approved', 'rejected', 'cancelled'].map((s) => <button key={s} onClick={() => { setStatus(s); setPage(1) }} className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${status === s ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-slate-300 bg-white'}`}>{s}</button>)}</div>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading ? <div className="p-5"><Skeleton className="h-24 w-full" /></div> : !q.data?.data.length ? <EmptyState icon={<ClipboardCheck className="size-6" />} title={`No ${status} requests`} hint="Requests for sensitive changes show up here." /> : (
          <ul className="divide-y divide-slate-100">
            {q.data.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-500">{r.requestId}</span><Badge tone="blue">{KIND[r.kind]}</Badge><Badge tone={TONE[r.status]}>{r.status}</Badge></div>
                  <p className="font-medium">{r.summary}</p>
                  {r.reason && <p className="text-sm text-slate-600">Reason: {r.reason}</p>}
                  <p className="text-xs text-slate-500">Asked by {r.requestedByName} · {formatDateTime(r.createdAt)}{r.decidedByName ? ` · ${r.status} by ${r.decidedByName}` : ''}{r.decisionNote && r.status === 'rejected' ? ` — ${r.decisionNote}` : ''}</p>
                </div>
                {r.status === 'pending' && (
                  <div className="flex gap-2">
                    {decider && <Button loading={busy === r.id} onClick={() => act(r.id, () => approvalService.approve(r.id), 'Approved and carried out')}><Check className="size-4" />Approve</Button>}
                    {decider && <Button variant="secondary" onClick={() => setRejecting(r)}><X className="size-4" />Reject</Button>}
                    {!decider && <Button variant="secondary" onClick={() => act(r.id, () => approvalService.cancel(r.id), 'Request cancelled')}>Cancel request</Button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {q.data && <Pagination p={q.data.pagination} onPage={setPage} />}
      </div>
      {rejecting && <ReasonDialog open danger title={`Reject ${rejecting.requestId}?`} message="Nothing will be changed. The reason is shown to the person who asked." confirmLabel="Reject" onConfirm={(reason) => act(rejecting.id, () => approvalService.reject(rejecting.id, reason), 'Request rejected')} onCancel={() => setRejecting(null)} />}
    </div>
  )
}
