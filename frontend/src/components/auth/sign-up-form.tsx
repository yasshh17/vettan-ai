"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, MailCheck } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthCard } from "@/components/auth/auth-card"
import { AuthField } from "@/components/auth/auth-field"
import { GoogleButton } from "@/components/auth/google-button"
import { validateEmail, validateName, validatePassword } from "@/components/auth/validation"

export function SignUpForm() {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{
    fullName?: string | null
    email?: string | null
    password?: string | null
  }>({})
  const [formError, setFormError] = useState("")
  const [loading, setLoading] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nameError = validateName(fullName)
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)
    if (nameError || emailError || passwordError) {
      setErrors({ fullName: nameError, email: emailError, password: passwordError })
      return
    }
    setErrors({})
    setFormError("")
    setLoading(true)

    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        setFormError(
          /registered|already/i.test(error.message)
            ? "An account with this email already exists."
            : error.message
        )
        setLoading(false)
        return
      }

      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setFormError("An account with this email already exists.")
        setLoading(false)
        return
      }

      if (data.session) {
        router.push("/app")
        router.refresh()
        return
      }

      setCheckEmail(true)
      setLoading(false)
    } catch {
      setFormError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  if (checkEmail) {
    return (
      <AuthCard className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(124,111,240,0.12)]">
          <MailCheck className="h-6 w-6 text-[#9C90FF]" />
        </div>
        <h2 className="mt-5 text-[20px] font-semibold text-[#EDEDF2]">Check your email</h2>
        <p className="mt-2 text-[15px] text-[#9B9BA8]">
          We sent a confirmation link to <span className="text-[#EDEDF2]">{email}</span>. Confirm
          it to finish setting up your account.
        </p>
      </AuthCard>
    )
  }

  return (
    <>
      <AuthCard>
        <GoogleButton />
        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
          <span className="text-[13px] text-[#6B6B78]">or</span>
          <div className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {formError && (
            <div className="rounded-lg border border-[#f87171]/30 bg-[#1e1a1a] px-4 py-3 text-[14px] text-[#f87171]">
              {formError}
            </div>
          )}

          <AuthField
            id="fullName"
            label="Full name"
            type="text"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={errors.fullName}
          />

          <AuthField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />

          <AuthField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-[#9C90FF] text-[15px] font-semibold text-[#09090c] transition-colors hover:bg-[#B6ACFF] disabled:opacity-70"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
      </AuthCard>

      <p className="mt-6 text-center text-[13px] leading-relaxed text-[#6B6B78]">
        By continuing you agree to Vettan&apos;s Terms of Service and Privacy Policy.
      </p>
    </>
  )
}
