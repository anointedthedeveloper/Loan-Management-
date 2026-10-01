import { api, apiPage } from '../../../services/api'
import type { ActivityEntry, User } from '../../../types'
import type { PermissionCatalogue } from '../types'

export const staffService = {
  list: () => api<{ users: User[] }>('/users').then((r) => r.users),
  get: (id: string) => api<{ user: User }>(`/users/${id}`).then((r) => r.user),
  catalogue: () => api<PermissionCatalogue>('/users/permissions'),
  create: (body: unknown) => api<{ user: User }>('/users', { method: 'POST', body }).then((r) => r.user),
  update: (id: string, body: unknown) => api<{ user: User }>(`/users/${id}`, { method: 'PATCH', body }).then((r) => r.user),
  resetPassword: (id: string, password?: string) => api<{ temporaryPassword: string | null }>(`/users/${id}/reset-password`, { method: 'POST', body: { password } }),
  remove: (id: string) => api<null>(`/users/${id}`, { method: 'DELETE' }),
  activity: (id: string) => apiPage<ActivityEntry>(`/users/${id}/activity?limit=50`),
}
