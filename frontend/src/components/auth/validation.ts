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

export function validatePasswordConfirmation(password: string, confirm: string): string | null {
  if (!confirm) return "Please confirm your password."
  if (password !== confirm) return "Passwords do not match."
  return null
}

export function validateDateOfBirth(dob: string): string | null {
  if (!dob) return "Date of birth is required."

  const parsed = new Date(`${dob}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return "Enter a valid date of birth."

  const today = new Date()
  if (parsed.getTime() > today.getTime()) return "Date of birth can't be in the future."

  let age = today.getFullYear() - parsed.getFullYear()
  const monthDiff = today.getMonth() - parsed.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) {
    age--
  }

  if (age < 18) return "You must be at least 18 years old to sign up."
  return null
}
