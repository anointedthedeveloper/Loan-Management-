import { Badge } from '../../../components/ui/feedback'
import { useCustomerMeta } from '../hooks/useCustomerMeta'

export function CustomerStatusBadge({ status }: { status: string }) {
  const meta = useCustomerMeta()
  const s = meta?.statuses.find((x) => x.value === status)
  return <Badge tone={s?.tone ?? 'slate'}>{s?.label ?? status}</Badge>
}
