import { z } from 'zod';
import { ROLES, isPermission } from '../config/permissions.js';
import { strongPassword } from './auth.js';

const permissionList = z.array(z.string().refine(isPermission, 'Unknown permission'));

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Enter full name').max(100),
  email: z.string().trim().email('Enter a valid email'),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, '3-30 letters, numbers, . _ -'),
  password: strongPassword,
  role: z.enum(ROLES),
  permissions: permissionList.optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().optional(),
  isActive: z.boolean().optional(),
  role: z.enum(ROLES).optional(),
  permissions: permissionList.optional(),
  password: strongPassword.optional(),
});
