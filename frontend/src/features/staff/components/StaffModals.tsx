import { useState, type FormEvent } from 'react'
import { Copy } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { SelectField } from '../../../components/ui/FormControls'
import { Modal } from '../../../components/ui/Modal'
import type { User } from '../../../types'
import { staffService } from '../services/staffService'
import type { PermissionCatalogue } from '../types'
import { PermissionPicker } from './PermissionPicker'

export function CreateStaffModal({ cat, onClose, onDone }: { cat: PermissionCatalogue; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: '', email: '', username: '', password: '', role: 'accountant' })
  const [perms, setPerms] = useState<string[]>(cat.defaults.accountant ?? [])
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const isCeo = f.role === 'ceo'

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({})
    try { await staffService.create({ ...f, permissions: isCeo ? undefined : perms }); toast('success', `${f.name} added`); onDone() }
    catch (err) {
      if (err instanceof ApiError && err.fields) setErrs(err.fields)
      toast('error', err instanceof ApiError ? err.message : 'Could not create account')
    } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Add staff member" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" value={f.name} onChange={set('name')} error={errs.name} autoFocus />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} error={errs.email} />
          <Field label="Username" value={f.username} onChange={set('username')} error={errs.username} />
          <Field label="Temporary password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errs.password} />
        </div>
        <SelectField label="Role" options={cat.roles} value={f.role} placeholder="Choose role" onChange={(e) => { setF((s) => ({ ...s, role: e.target.value })); setPerms(cat.defaults[e.target.value] ?? []) }} />
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Permissions</p>
          {isCeo && <p className="mb-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">CEO accounts always hold every permission.</p>}
          <PermissionPicker groups={cat.groups} value={isCeo ? cat.groups.flatMap((g) => g.permissions.map((p) => p.key)) : perms} onChange={setPerms} disabled={isCeo} />
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Creating…">Create account</Button></div>
      </form>
    </Modal>
  )
}

export function EditProfileModal({ user, cat, isSelf, onClose, onDone }: { user: User; cat: PermissionCatalogue; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState(user.role)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({})
    try { await staffService.update(user.id, { name, email, ...(role !== user.role ? { role } : {}) }); toast('success', 'Profile updated'); onDone() }
    catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not save') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Edit staff profile">
      <form onSubmit={save} className="space-y-4">
        <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={errs.name} />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} />
        <SelectField label="Role" options={cat.roles} value={role} placeholder="Choose role" disabled={isSelf} onChange={(e) => setRole(e.target.value)} />
        {role !== user.role && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Changing the role resets this person's permissions to the new role's defaults.</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…">Save</Button></div>
      </form>
    </Modal>
  )
}

export function ResetPasswordModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'generate' | 'set'>('generate')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [temp, setTemp] = useState<string | null>(null)

  async function reset(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const r = await staffService.resetPassword(user.id, mode === 'set' ? pw : undefined)
      if (r.temporaryPassword) setTemp(r.temporaryPassword); else { toast('success', 'Password reset'); onDone() }
    } catch (e2) { setErr(e2 instanceof ApiError ? (e2.fields?.password ?? e2.message) : 'Could not reset password') }
    finally { setBusy(false) }
  }
  if (temp) return (
    <Modal open onClose={onDone} title="Temporary password">
      <p className="text-sm text-slate-600">Share this with {user.name} securely. It is shown only once and is not stored anywhere readable. Existing sessions have been signed out.</p>
      <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 font-mono text-lg tracking-wider">
        <span data-testid="temp-password">{temp}</span>
        <button onClick={() => { void navigator.clipboard?.writeText(temp); toast('info', 'Copied') }} aria-label="Copy password" className="text-slate-500 hover:text-ink"><Copy className="size-5" /></button>
      </div>
      <div className="mt-5 flex justify-end"><Button onClick={onDone}>Done</Button></div>
    </Modal>
  )
  return (
    <Modal open onClose={onClose} title={`Reset password for ${user.name}`}>
      <form onSubmit={reset} className="space-y-4">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} className="accent-brand-700" />Generate a temporary password</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'set'} onChange={() => setMode('set')} className="accent-brand-700" />Set a specific password</label>
        </div>
        {mode === 'set' && <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={err} />}
        {mode === 'generate' && err && <p className="text-sm text-red-600">{err}</p>}
        <p className="text-xs text-slate-500">All of this person's current sessions will be signed out. This action is recorded in the audit log.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Resetting…">Reset password</Button></div>
      </form>
    </Modal>
  )
}
