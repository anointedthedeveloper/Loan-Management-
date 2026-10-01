import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, Landmark, Banknote, ReceiptText, ArrowUpRight, BarChart3, ScrollText, Settings, UserCog, LogOut, Menu, X, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/ui/Logo'
import { dashboardPathFor } from '../routes/ProtectedRoute'
import { PERM } from '../config/permissions'

interface NavItem { label: string; to?: string; icon: typeof Users; permission?: string; soon?: boolean }

export default function AppLayout() {
  const { user, can, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  if (!user) return null

  const items: NavItem[] = [
    { label: 'Dashboard', to: dashboardPathFor(user.role), icon: LayoutDashboard },
    { label: 'Customers', to: '/customers', icon: Users, permission: PERM.customers.read },
    { label: 'Loans', icon: Landmark, permission: PERM.loans.view, soon: true },
    { label: 'Repayments', icon: Banknote, permission: PERM.repayments.view, soon: true },
    { label: 'Transactions', icon: ReceiptText, permission: PERM.transactions.view, soon: true },
    { label: 'Top-ups', icon: ArrowUpRight, permission: PERM.topups.view, soon: true },
    { label: 'Reports', icon: BarChart3, permission: PERM.reports.view, soon: true },
    { label: 'Staff & Permissions', to: '/staff', icon: UserCog, permission: PERM.staff.manage },
    { label: 'Audit Log', icon: ScrollText, permission: PERM.audit.view, soon: true },
    { label: 'Settings', icon: Settings, permission: PERM.settings.manage, soon: true },
  ]
  const visible = items.filter((i) => !i.permission || can(i.permission))
  const crumbs = loc.pathname.split('/').filter(Boolean)
  const titleOf = (seg: string) =>
    ({ ceo: 'Dashboard', accountant: 'Dashboard', staff: 'Staff & Permissions', customers: 'Customers', new: 'Add customer', edit: 'Edit' } as Record<string, string>)[seg] ?? (/^[a-f\d]{24}$/i.test(seg) ? 'Details' : seg)

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 text-white">
      <div className="flex h-16 items-center justify-between px-5"><Logo dark /><button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button></div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visible.map((i) => i.to ? (
          <NavLink key={i.label} to={i.to} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-white/15 text-white' : 'text-brand-100/80 hover:bg-white/10 hover:text-white'}`}>
            <i.icon className="size-[18px]" />{i.label}
          </NavLink>
        ) : (
          <div key={i.label} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-100/40" title="Arrives in an upcoming phase">
            <i.icon className="size-[18px]" />{i.label}<span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-brand-100/60">© {new Date().getFullYear()} Protech</div>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50 animate-fade-in" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 animate-fade-in">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded p-1.5 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-slate-500">
              <Link to="/" className="hover:text-ink">Protech</Link>
              {crumbs.map((c, idx) => <span key={c + idx} className="flex items-center gap-1.5"><ChevronRight className="size-3.5" /><span className={idx === crumbs.length - 1 ? 'font-semibold text-ink' : ''}>{titleOf(c)}</span></span>)}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{user.name}</p>
              <p className="text-xs capitalize text-slate-500">{user.role === 'ceo' ? 'CEO / Super Admin' : user.role}</p>
            </div>
            <button onClick={async () => { await logout(); nav('/login') }} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"><LogOut className="size-4" /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div key={loc.pathname} className="mx-auto max-w-7xl animate-fade-up"><Outlet /></div></main>
      </div>
    </div>
  )
}
