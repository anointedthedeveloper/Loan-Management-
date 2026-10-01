const BASE = import.meta.env.VITE_API_URL ?? '/api'
const KEY = 'protech.token'

export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string>
  constructor(message: string, status: number, code: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export const tokenStore = {
  get: () => { try { return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY) } catch { return null } },
  set: (t: string, remember: boolean) => {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); (remember ? localStorage : sessionStorage).setItem(KEY, t) } catch { /* storage unavailable */ }
  },
  clear: () => { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY) } catch { /* ignore */ } },
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get()
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK')
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) {
    if (res.status === 401 && token && json?.code === 'TOKEN_INVALID') onUnauthorized?.()
    throw new ApiError(json?.message ?? 'Request failed. Please try again.', res.status, json?.code ?? 'ERROR', json?.errors)
  }
  return json.data as T
}
