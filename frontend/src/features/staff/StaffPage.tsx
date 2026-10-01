import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, UserCog, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { PermissionInfo, Role, User } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback'

type Catalogue = { permissions: PermissionInfo[]; defaults: Record<Role, string[]> }

export default function StaffPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<User[] | null>(null)
  const [cat, setCat] = useState<Catalogue | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [u, c] = await Promise.all([api<{ users: User[] }>('/users'), api<Catalogue>('/users/permissions')])
      setUsers(u.users); setCat(c)
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Unexpected error') }
  }, [])
  useEffect(() => { void load() }, [load])

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try { await api(`/users/${deleting.id}`, { method: 'DELETE' }); toast('success', 'Staff account deleted'); setDeleting(null); await load() }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not delete') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Staff & Permissions</h1><p className="text-sm text-slate-500">Create accountants and control exactly what each person can access.</p></div>
        <Button onClick={() => setCreating(true)} disabled={!cat}><Plus className="size-4" />Add staff</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {error ? <ErrorState message={error} onRetry={load} /> : !users ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : users.length === 0 ? <EmptyState icon={<UserCog className="size-6" />} title="No staff yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="hidden px-4 py-3 md:table-cell">Last sign-in</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><p className="font-medium">{u.name}</p><p className="text-xs text-slate-500">{u.email} · @{u.username}</p></td>
                    <td className="px-4 py-3 capitalize">{u.role === 'ceo' ? 'CEO' : u.role}</td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-NG') : 'Never'}</td>
                    <td className="px-4 py-3"><Badge tone={u.isActive ? 'green' : 'slate'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="!px-2.5 !py-1.5" onClick={() => setEditing(u)}><ShieldCheck className="size-4" />Manage</Button>
                        {u.id !== me?.id && <Button variant="ghost" className="!px-2.5 !py-1.5 text-red-600" aria-label={`Delete ${u.name}`} onClick={() => setDeleting(u)}><Trash2 className="size-4" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {cat && <CreateModal open={creating} cat={cat} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load() }} />}
      {cat && editing && <EditModal user={editing} cat={cat} isSelf={editing.id === me?.id} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load() }} />}
      <ConfirmDialog open={!!deleting} danger loading={busy} title="Delete staff account?" message={`${deleting?.name} will lose access immediately. This is recorded in the audit log. To keep history but block sign-in, deactivate the account instead.`} confirmLabel="Delete account" onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
    </div>
  )
}

function PermissionPicker({ cat, value, onChange, disabled }: { cat: Catalogue; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {cat.permissions.map((p) => (
        <label key={p.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${value.includes(p.key) ? 'border-brand-500 bg-brand-50' : 'border-slate-200'} ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
          <input type="checkbox" disabled={disabled} checked={value.includes(p.key)} onChange={() => toggle(p.key)} className="accent-brand-700" />{p.label}
        </label>
      ))}
    </div>
  )
}

function CreateModal({ open, cat, onClose, onDone }: { open: boolean; cat: Catalogue; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: '', email: '', username: '', password: '', role: 'accountant' as Role })
  const [perms, setPerms] = useState<string[]>(cat.defaults.accountant)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({})
    try {
      await api('/users', { method: 'POST', body: { ...f, permissions: perms } })
      toast('success', `${f.name} added`); setF({ name: '', email: '', username: '', password: '', role: 'accountant' }); onDone()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrs(err.fields as Record<string, string>)
      toast('error', err instanceof ApiError ? err.message : 'Could not create account')
    } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add staff member" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" value={f.name} onChange={set('name')} error={errs.name} />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} error={errs.email} />
          <Field label="Username" value={f.username} onChange={set('username')} error={errs.username} />
          <Field label="Temporary password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errs.password} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
          <select value={f.role} onChange={(e) => { const r = e.target.value as Role; setF((s) => ({ ...s, role: r })); setPerms(cat.defaults[r]) }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="accountant">Accountant</option><option value="ceo">CEO / Super Admin</option>
          </select>
        </div>
        <div><p className="mb-1.5 text-sm font-medium text-slate-700">Permissions</p><PermissionPicker cat={cat} value={perms} onChange={setPerms} disabled={f.role === 'ceo'} /></div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Create account</Button></div>
      </form>
    </Modal>
  )
}

function EditModal({ user, cat, isSelf, onClose, onDone }: { user: User; cat: Catalogue; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [perms, setPerms] = useState<string[]>(user.permissions)
  const [active, setActive] = useState(user.isActive)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: { isActive: active, ...(user.role !== 'ceo' ? { permissions: perms } : {}), ...(pw ? { password: pw } : {}) } })
      toast('success', 'Changes saved'); onDone()
    } catch (e) { toast('error', e instanceof ApiError ? (e.fields ? Object.values(e.fields)[0] ?? e.message : e.message) : 'Could not save') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Manage ${user.name}`} wide>
      <div className="space-y-4">
        <label className={`flex items-center gap-2 text-sm ${isSelf ? 'opacity-60' : ''}`}><input type="checkbox" disabled={isSelf} checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-brand-700" />Account active</label>
        {user.role === 'ceo' ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">CEO accounts always hold every permission.</p> : (
          <div><p className="mb-1.5 text-sm font-medium text-slate-700">Permissions</p><PermissionPicker cat={cat} value={perms} onChange={setPerms} /></div>
        )}
        <Field label="Reset password (optional)" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Leave blank to keep current" />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save changes</Button></div>
      </div>
    </Modal>
  )
}
