import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authService } from '../services/authService'
import { setUnauthorizedHandler, tokenStore } from '../services/api'
import type { User } from '../types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (identifier: string, password: string, remember: boolean) => Promise<User>
  logout: () => Promise<void>
  /** UI convenience only — the backend independently enforces every permission. */
  can: (permission: string) => boolean
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setUnauthorizedHandler(() => { tokenStore.clear(); setUser(null) })
    if (!tokenStore.get()) { setLoading(false); return }
    authService.me().then((r) => setUser(r.user)).catch(() => tokenStore.clear()).finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (identifier: string, password: string, remember: boolean) => {
    const r = await authService.login(identifier, password, remember)
    tokenStore.set(r.token, remember)
    setUser(r.user)
    return r.user
  }, [])

  const logout = useCallback(async () => {
    try { await authService.logout() } catch { /* token may already be invalid */ }
    tokenStore.clear()
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(() => ({ user, loading, login, logout, can: (p) => !!user?.permissions.includes(p) }), [user, loading, login, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used inside AuthProvider')
  return c
}
