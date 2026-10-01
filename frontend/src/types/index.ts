export type Role = 'ceo' | 'accountant'

export interface User {
  id: string
  name: string
  email: string
  username: string
  role: Role
  permissions: string[]
  isActive: boolean
  lastLoginAt: string | null
}

export interface ApiEnvelope<T> { success: boolean; message?: string; data: T }
export interface PermissionInfo { key: string; label: string }
