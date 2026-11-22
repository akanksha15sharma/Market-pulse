import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
// Never trim or silently truncate passwords; allow passphrases and password managers.
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128);
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();
export const emailRequestSchema = z.object({ email: emailSchema }).strict();
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const verifyEmailSchema = z.object({ token: tokenSchema }).strict();
export const resetPasswordSchema = z
  .object({ token: tokenSchema, password: passwordSchema })
  .strict();
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  displayName: z.string(),
  emailVerified: z.boolean(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
