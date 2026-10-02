import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { KeyRound, Pencil, Power, Save } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import type { ActivityEntry, User } from '../../../types'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Modal'
import { Badge, ErrorState, Skeleton } from '../../../components/ui/feedback'
import { ActivityList } from '../../../components/dashboard'
import { formatDateTime } from '../../../utils/format'
import { staffService } from '../services/staffService'
import type { PermissionCatalogue } from '../types'
import { PermissionPicker } from '../components/PermissionPicker'
import { EditProfileModal, ResetPasswordModal } from '../components/StaffModals'

export default function StaffDetailPage() {
  const { id = '' } = useParams()
  const { user: me, refresh } = useAuth()
  const toast = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [cat, setCat] = useState<PermissionCatalogue | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null)
  const [error, setError] = useState('')
  const [perms, setPerms] = useState<string[]>([])
  const [modal, setModal] = useState<'edit' | 'reset' | 'status' | null>(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0)
  const reload = () => setKey((k) => k + 1)

  useEffect(() => {
    setError('')
    Promise.all([staffService.get(id), staffService.catalogue(), staffService.activity(id)])
      .then(([u, c, a]) => { setUser(u); setPerms(u.permissions); setCat(c); setActivity(a.data) })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Unexpected error'))
  }, [id, key])

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!user || !cat) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
  const isSelf = user.id === me?.id
  const isCeo = user.role === 'ceo'
  const dirty = !isCeo && JSON.stringify([...perms].sort()) !== JSON.stringify([...user.permissions].sort())

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try { await fn(); toast('success', ok); setModal(null); reload(); if (user?.id === me?.id) void refresh() }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Action failed'); setModal(null) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-700">{user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold tracking-tight">{user.name}</h1><Badge tone={user.isActive ? 'green' : 'slate'}>{user.isActive ? 'Active' : 'Deactivated'}</Badge><Badge tone="blue">{cat.roles.find((r) => r.value === user.role)?.label ?? user.role}</Badge></div>
            <p className="text-sm text-slate-500">{user.email} · @{user.username}</p>
            <p className="text-xs text-slate-400">Last sign-in: {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModal('edit')}><Pencil className="size-4" />Edit</Button>
          <Button variant="secondary" onClick={() => setModal('reset')}><KeyRound className="size-4" />Reset password</Button>
          {!isSelf && <Button variant={user.isActive ? 'danger' : 'primary'} onClick={() => setModal('status')}><Power className="size-4" />{user.isActive ? 'Deactivate' : 'Activate'}</Button>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Permissions</h2>
            {dirty && <Button loading={busy} onClick={() => run(() => staffService.update(user.id, { permissions: perms }), 'Permissions updated')}><Save className="size-4" />Save permissions</Button>}</div>
          <p className="mb-4 mt-1 text-sm text-slate-500">{isCeo ? 'CEO accounts always hold every permission.' : 'Changes apply on the person’s next request and are recorded in the audit log.'}</p>
          <PermissionPicker groups={cat.groups} value={isCeo ? cat.groups.flatMap((g) => g.permissions.map((p) => p.key)) : perms} onChange={setPerms} disabled={isCeo} />
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="font-semibold">Activity</h2>
          <p className="text-sm text-slate-500">Sign-ins, account changes and actions on this account.</p>
          <div className="mt-2 max-h-[560px] overflow-y-auto"><ActivityList items={activity ?? []} showDetails emptyText="No activity yet." /></div>
        </section>
      </div>

      {modal === 'edit' && <EditProfileModal user={user} cat={cat} isSelf={isSelf} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); if (isSelf) void refresh() }} />}
      {modal === 'reset' && <ResetPasswordModal user={user} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      <ConfirmDialog open={modal === 'status'} danger={user.isActive} loading={busy} title={user.isActive ? 'Deactivate account?' : 'Activate account?'}
        message={user.isActive ? `${user.name} will be signed out and unable to sign in until reactivated. Their history is kept.` : `${user.name} will be able to sign in again.`}
        confirmLabel={user.isActive ? 'Deactivate' : 'Activate'} onConfirm={() => run(() => staffService.update(user.id, { isActive: !user.isActive }), user.isActive ? 'Account deactivated' : 'Account activated')} onCancel={() => setModal(null)} />
    </div>
  )
}
