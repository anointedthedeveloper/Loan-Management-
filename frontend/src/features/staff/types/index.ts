import type { PermissionGroup, Option } from '../../../types'
export interface PermissionCatalogue { groups: PermissionGroup[]; defaults: Record<string, string[]>; roles: Option[] }
