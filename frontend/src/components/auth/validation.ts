const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(email: string): string | null {
  if (!email.trim()) return "Email is required."
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address."
  return null
}

export const MIN_PASSWORD_LENGTH = 8

/** Rules for choosing a password (sign-up, reset). Keep in step with Supabase Auth's password policy. */
export function validatePassword(password: string): string | null {
  if (!password) return "Password is required."
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  return null
}

/**
 * Sign-in only checks that a password was entered. Applying the length rule
 * here would lock out accounts created under the older 6-character minimum.
 */
export function validateSignInPassword(password: string): string | null {
  if (!password) return "Password is required."
  return null
}

export function validateName(name: string): string | null {
  if (!name.trim()) return "Full name is required."
  return null
}

export function validatePasswordConfirmation(password: string, confirm: string): string | null {
  if (!confirm) return "Please confirm your password."
  if (password !== confirm) return "Passwords do not match."
  return null
}
