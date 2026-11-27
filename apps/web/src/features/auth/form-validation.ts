import {
  emailRequestSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@marketpulse/contracts';
import { ApiError } from '../../lib/api-client';
export type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
export type AuthField =
  'displayName' | 'email' | 'password' | 'confirmPassword' | 'token';
export type AuthErrors = Partial<Record<AuthField, string>>;

export function validateAuthForm(
  mode: AuthMode,
  input: Record<string, unknown>,
  token = '',
) {
  const schema =
    mode === 'login'
      ? loginSchema
      : mode === 'register'
        ? registerSchema
        : mode === 'forgot'
          ? emailRequestSchema
          : resetPasswordSchema;
  const raw =
    mode === 'reset'
      ? { token, password: input.password }
      : mode === 'forgot'
        ? { email: input.email }
        : {
            email: input.email,
            password: input.password,
            ...(mode === 'register' ? { displayName: input.displayName } : {}),
          };
  const parsed = schema.safeParse(raw);
  const errors: AuthErrors = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as AuthField;
      errors[field] =
        field === 'email'
          ? 'Enter a valid email address.'
          : field === 'displayName'
            ? 'Enter a display name of 1–100 characters.'
            : field === 'token'
              ? 'This reset link is missing or invalid. Request a new link.'
              : mode === 'login'
                ? 'Enter your password (up to 128 characters).'
                : 'Use 12–128 characters. Passphrases and spaces are welcome.';
    }
  if (mode === 'register' || mode === 'reset') {
    if (!input.confirmPassword)
      errors.confirmPassword = 'Confirm your password.';
    else if (input.confirmPassword !== input.password)
      errors.confirmPassword = 'Passwords do not match.';
  }
  return {
    errors,
    data:
      parsed.success && !Object.keys(errors).length ? parsed.data : undefined,
  };
}

export function authFailureMessage(error: unknown, mode: AuthMode | 'verify') {
  if (error instanceof ApiError) {
    if (error.status === 0)
      return 'Cannot reach MarketPulse. Check your connection and try again.';
    if (error.status === 429)
      return 'Too many attempts. Please wait before trying again.';
    if (error.status === 401 && mode === 'login')
      return 'Invalid email or password.';
    if (error.status === 400 && mode === 'reset')
      return 'Invalid or expired reset link. Request a new link and try again.';
    if (error.status === 400 && mode === 'verify')
      return 'Invalid or expired verification link. Request a new link from your account.';
    if (error.status === 400) return 'Please check your details and try again.';
    if (error.status === 403)
      return 'Could not securely submit this request. Refresh the page and try again.';
    if (error.status === 409)
      return mode === 'register'
        ? 'Unable to create an account with those details. Try signing in or use another email.'
        : 'Your session changed. Refresh the page and try again.';
  }
  return 'This service is temporarily unavailable. Please try again later.';
}
