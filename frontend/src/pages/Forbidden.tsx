import { ShieldAlert } from 'lucide-react'
import { EmptyState } from '../components/ui/feedback'

export default function Forbidden() {
  return <EmptyState icon={<ShieldAlert className="size-6" />} title="Access restricted" hint="You don't have permission to view this section. Contact the CEO if you believe this is a mistake." />
}
