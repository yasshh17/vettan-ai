const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(email: string): string | null {
  if (!email.trim()) return "Email is required."
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address."
  return null
}

export function validatePassword(password: string): string | null {
  if (!password) return "Password is required."
  if (password.length < 6) return "Password must be at least 6 characters."
  return null
}

export function validateName(name: string): string | null {
  if (!name.trim()) return "Full name is required."
  return null
}
