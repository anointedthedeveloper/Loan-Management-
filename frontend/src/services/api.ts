const BASE = import.meta.env.VITE_API_URL ?? '/api'
const KEY = 'protech.token'

/** Number of requests currently in flight, so the UI can show a global loading bar. */
let pending = 0
const listeners = new Set<() => void>()
export const pendingStore = {
  get: () => pending,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
}
const track = (d: number) => { pending = Math.max(0, pending + d); listeners.forEach((l) => l()) }

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

export interface Pagination { page: number; limit: number; total: number; pages: number }

async function request(path: string, opts: { method?: string; body?: unknown }) {
  track(1)
  try { return await doRequest(path, opts) } finally { track(-1) }
}

async function doRequest(path: string, opts: { method?: string; body?: unknown }) {
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
  return json
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  return (await request(path, opts)).data as T
}

/** For list endpoints that return `{ data: [], pagination }`. */
export async function apiPage<T>(path: string): Promise<{ data: T[]; pagination: Pagination }> {
  const j = await request(path, {})
  return { data: j.data as T[], pagination: j.pagination as Pagination }
}

/** Builds a query string, skipping empty values. */
export const qs = (params: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

/** Downloads a file response (CSV / Excel / PDF) using the signed-in user's token. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const token = tokenStore.get()
  let res: Response
  try { res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }) } catch { throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK') }
  if (!res.ok) { const j = await res.json().catch(() => null); throw new ApiError(j?.message ?? 'Download failed', res.status, j?.code ?? 'ERROR') }
  const name = /filename="?([^"]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
