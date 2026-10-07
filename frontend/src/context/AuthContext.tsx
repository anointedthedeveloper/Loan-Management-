import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authService } from '../services/authService'
import { ApiError, setUnauthorizedHandler, tokenStore, userCache } from '../services/api'
import type { User } from '../types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (identifier: string, password: string, remember: boolean) => Promise<User>
  logout: () => Promise<void>
  /** Reloads the signed-in user (e.g. after editing your own profile or permissions). */
  refresh: () => Promise<void>
  /** UI convenience only — the backend independently enforces every permission. */
  can: (permission: string) => boolean
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Signed in before? Start from the cached user so a reload goes straight to the app; the server re-checks it in the background.
  const [user, setUser] = useState<User | null>(() => (tokenStore.get() ? userCache.get<User>() : null))
  const [loading, setLoading] = useState(() => !!tokenStore.get() && !userCache.get<User>())

  useEffect(() => {
    setUnauthorizedHandler(() => { tokenStore.clear(); setUser(null) })
    if (!tokenStore.get()) { setLoading(false); return }
    authService.me()
      .then((r) => { setUser(r.user); userCache.set(r.user) })
      .catch((e) => { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { tokenStore.clear(); setUser(null) } /* offline or a slow server must not sign anyone out */ })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (identifier: string, password: string, remember: boolean) => {
    const r = await authService.login(identifier, password, remember)
    tokenStore.set(r.token, remember)
    userCache.set(r.user)
    setUser(r.user)
    return r.user
  }, [])

  const logout = useCallback(async () => {
    try { await authService.logout() } catch { /* token may already be invalid */ }
    tokenStore.clear()
    setUser(null)
  }, [])

  const refresh = useCallback(async () => { try { const u = (await authService.me()).user; setUser(u); userCache.set(u) } catch { /* keep current user; a 401 is handled globally */ } }, [])

  const value = useMemo<AuthState>(() => ({ user, loading, login, logout, refresh, can: (p) => !!user?.permissions.includes(p) }), [user, loading, login, logout, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used inside AuthProvider')
  return c
}
