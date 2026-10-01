import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, UserCog } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import type { User } from '../../../types'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Modal'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { formatDateTime } from '../../../utils/format'
import { staffService } from '../services/staffService'
import type { PermissionCatalogue } from '../types'
import { CreateStaffModal } from '../components/StaffModals'

export default function StaffListPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<User[] | null>(null)
  const [cat, setCat] = useState<PermissionCatalogue | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0)

  useEffect(() => {
    setError('')
    Promise.all([staffService.list(), staffService.catalogue()]).then(([u, c]) => { setUsers(u); setCat(c) }).catch((e) => setError(e instanceof ApiError ? e.message : 'Unexpected error'))
  }, [key])
  const reload = () => setKey((k) => k + 1)
  const roleLabel = (r: string) => cat?.roles.find((x) => x.value === r)?.label ?? r

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try { await staffService.remove(deleting.id); toast('success', 'Staff account deleted'); setDeleting(null); reload() }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not delete'); setDeleting(null) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Staff & Permissions</h1><p className="text-sm text-slate-500">Create staff accounts and control exactly what each person can access.</p></div>
        <Button onClick={() => setCreating(true)} disabled={!cat}><Plus className="size-4" />Add staff</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {error ? <ErrorState message={error} onRetry={reload} /> : !users ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          : users.length === 0 ? <EmptyState icon={<UserCog className="size-6" />} title="No staff yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="hidden px-4 py-3 md:table-cell">Last sign-in</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><Link to={`/staff/${u.id}`} className="font-medium hover:text-brand-700 hover:underline">{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}</Link><p className="text-xs text-slate-500">{u.email} · @{u.username}</p></td>
                    <td className="px-4 py-3">{roleLabel(u.role)}</td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                    <td className="px-4 py-3"><Badge tone={u.isActive ? 'green' : 'slate'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge></td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1">
                      <Link to={`/staff/${u.id}`}><Button variant="ghost" className="!px-2.5 !py-1.5">Manage</Button></Link>
                      {u.id !== me?.id && <Button variant="ghost" className="!px-2.5 !py-1.5 text-red-600" aria-label={`Delete ${u.name}`} onClick={() => setDeleting(u)}><Trash2 className="size-4" /></Button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && cat && <CreateStaffModal cat={cat} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload() }} />}
      <ConfirmDialog open={!!deleting} danger loading={busy} title="Delete staff account?" confirmLabel="Delete account"
        message={`${deleting?.name} will lose access immediately and the account cannot be recovered. To keep their history but block sign-in, deactivate the account instead.`} onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
    </div>
  )
}
