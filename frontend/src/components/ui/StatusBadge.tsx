import { Badge } from './feedback'
import { useLoanMeta } from '../../hooks/useLoanMeta'
import { titleCase } from '../../utils/format'
import type { Tone } from '../../types'

export function LoanStatusBadge({ status }: { status: string }) {
  const meta = useLoanMeta()
  const s = meta?.statuses.find((x) => x.value === status)
  return <Badge tone={s?.tone ?? 'slate'}>{s?.label ?? titleCase(status)}</Badge>
}

const installmentTone: Record<string, Tone> = { paid: 'green', overdue: 'red', due: 'amber', partially_paid: 'blue', upcoming: 'slate' }
export const InstallmentBadge = ({ status }: { status: string }) => <Badge tone={installmentTone[status] ?? 'slate'}>{titleCase(status)}</Badge>

const topUpTone: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'slate' }
export const TopUpStatusBadge = ({ status }: { status: string }) => <Badge tone={topUpTone[status] ?? 'slate'}>{titleCase(status)}</Badge>

export const TxStateBadge = ({ state }: { state: string }) => <Badge tone={state === 'reversed' ? 'red' : 'green'}>{titleCase(state)}</Badge>

export const LoanTypeBadge = ({ type }: { type?: string }) => (type === 'renewal' ? <Badge tone="blue">Renewal</Badge> : type === 'topup' ? <Badge tone="blue">Top-up</Badge> : null)
