import { api } from './api'
import type { User } from '../types'

export const authService = {
  login: (identifier: string, password: string, remember: boolean) =>
    api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { identifier, password, remember } }),
  me: () => api<{ user: User }>('/auth/me'),
  logout: () => api<null>('/auth/logout', { method: 'POST' }),
  forgotPassword: (identifier: string) => api<null>('/auth/forgot-password', { method: 'POST', body: { identifier } }),
}
