export type Role = 'ceo' | 'accountant' | (string & {})

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

export type Tone = 'green' | 'red' | 'amber' | 'slate' | 'blue'
export interface Option { value: string; label: string }
export interface PermissionInfo { key: string; label: string }
export interface PermissionGroup { key: string; label: string; permissions: PermissionInfo[] }

export interface ActivityEntry {
  id: string; action: string; userName: string | null; userRole?: string | null; ip?: string | null; entity: string | null; entityId: string | null
  entityLabel: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; createdAt: string
}
