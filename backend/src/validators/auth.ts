import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username').max(120),
  password: z.string().min(1, 'Enter your password').max(200),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username').max(120),
});

export const strongPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: strongPassword,
});
