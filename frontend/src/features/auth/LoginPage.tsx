import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { ApiError } from '../../services/api'
import { authService } from '../../services/authService'
import { Logo } from '../../components/ui/Logo'
import { Button } from '../../components/ui/Button'
import { LoadingScreen } from '../../components/ui/feedback'
import { Field } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { dashboardPathFor } from '../../routes/ProtectedRoute'

const SLIDES = [
  { src: '/login/slide-1.svg', caption: 'Lending decisions backed by clear records.' },
  { src: '/login/slide-2.svg', caption: 'Collections and balances, always up to date.' },
  { src: '/login/slide-3.svg', caption: 'Every naira accounted for in the ledger.' },
]

export default function LoginPage() {
  const { user, login, loading } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [slide, setSlide] = useState(0)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({})
  const [formError, setFormError] = useState('')
  const [forgot, setForgot] = useState(false)
  const [forgotId, setForgotId] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 6500)
    return () => clearInterval(t)
  }, [])

  if (loading) return <LoadingScreen /> // a saved session is being checked: don't flash the form
  if (user) return <Navigate to={dashboardPathFor(user.role)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!identifier.trim()) next.identifier = 'Enter your email or username'
    if (!password) next.password = 'Enter your password'
    setErrors(next); setFormError('')
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const u = await login(identifier.trim(), password, remember)
      navigate(dashboardPathFor(u.role), { replace: true })
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unable to sign in right now.')
    } finally { setBusy(false) }
  }

  async function sendForgot(e: FormEvent) {
    e.preventDefault()
    if (!forgotId.trim()) return
    setForgotBusy(true)
    try { const m = await authService.forgotPassword(forgotId.trim()); void m; toast('info', 'If an account matches, reset instructions will be sent. You can also ask the CEO to reset your password.'); setForgot(false) }
    catch (err) { toast('error', err instanceof ApiError ? err.message : 'Request failed') }
    finally { setForgotBusy(false) }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-brand-900 px-4 py-10">
      {SLIDES.map((s, i) => (
        <div key={s.src} aria-hidden className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[1400ms] ease-in-out ${i === slide ? 'opacity-100' : 'opacity-0'}`} style={{ backgroundImage: `url(${s.src})` }} />
      ))}
      <div className="absolute inset-0 bg-brand-900/55" />

      <div className="absolute left-6 top-6 hidden sm:block"><Logo dark /></div>
      <p key={slide} className="absolute bottom-8 left-6 hidden max-w-md animate-fade-in text-lg font-medium text-white/90 md:block">{SLIDES[slide]!.caption}</p>
      <div className="absolute bottom-8 right-6 hidden gap-1.5 md:flex">
        {SLIDES.map((_, i) => <button key={i} aria-label={`Slide ${i + 1}`} onClick={() => setSlide(i)} className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-6 bg-white' : 'w-1.5 bg-white/50'}`} />)}
      </div>

      <div className="relative w-full max-w-md animate-fade-up rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="sm:hidden"><Logo /></div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight sm:mt-0">Sign in to Protech</h1>
        <p className="mt-1 text-sm text-slate-500">Loan Management Portal — authorised staff only.</p>

        <form onSubmit={submit} noValidate className="mt-6 space-y-4">
          {formError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{formError}</div>}
          <Field label="Email or username" autoComplete="username" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} error={errors.identifier} placeholder="you@protech.com" />
          <Field label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password}
            right={<button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="text-slate-500 hover:text-slate-800">{show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}</button>} />
          <div className="flex items-center justify-between text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-slate-700"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 rounded border-slate-300 accent-brand-700" />Remember me</label>
            <button type="button" onClick={() => { setForgotId(identifier); setForgot(true) }} className="font-medium text-brand-600 hover:underline">Forgot password?</button>
          </div>
          <Button type="submit" loading={busy} loadingText="Signing in…" className="w-full">Sign in</Button>
        </form>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="size-4" />Activity on this system is monitored and logged.</p>
      </div>

      <Modal open={forgot} title="Reset your password" onClose={() => setForgot(false)}>
        <form onSubmit={sendForgot} className="space-y-4">
          <p className="text-sm text-slate-600">Enter your email or username. If the account exists, reset instructions will be sent. Until email delivery is configured, ask the CEO to reset your password.</p>
          <Field label="Email or username" value={forgotId} onChange={(e) => setForgotId(e.target.value)} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForgot(false)}>Cancel</Button><Button type="submit" loading={forgotBusy}>Send request</Button></div>
        </form>
      </Modal>
    </div>
  )
}
