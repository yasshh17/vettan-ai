"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2, MailCheck } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthCard } from "@/components/auth/auth-card"
import { AuthField } from "@/components/auth/auth-field"
import { validateEmail } from "@/components/auth/validation"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [errors, setErrors] = useState<{ email?: string | null }>({})
  const [formError, setFormError] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const emailError = validateEmail(email)
    if (emailError) {
      setErrors({ email: emailError })
      return
    }
    setErrors({})
    setFormError("")
    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      })

      // Never confirm/deny whether an email is registered: only a rate-limit
      // error gets surfaced, every other outcome (including any other
      // Supabase error) shows the same "check your email" success state.
      if (error && /rate limit|429/i.test(error.message)) {
        setFormError("Too many requests. Please wait a moment and try again.")
        setLoading(false)
        return
      }

      setSent(true)
      setLoading(false)
    } catch {
      setFormError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthCard className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(124,111,240,0.12)]">
          <MailCheck className="h-6 w-6 text-[#9C90FF]" />
        </div>
        <h2 className="mt-5 text-[20px] font-semibold text-[#EDEDF2]">Check your email</h2>
        <p className="mt-2 text-[15px] text-[#9B9BA8]">
          We sent a password reset link to <span className="text-[#EDEDF2]">{email}</span>. Click
          the link to choose a new password.
        </p>
      </AuthCard>
    )
  }

  return (
    <>
      <AuthCard>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {formError && (
            <div className="rounded-lg border border-[#f87171]/30 bg-[#1e1a1a] px-4 py-3 text-[14px] text-[#f87171]">
              {formError}
            </div>
          )}

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

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-[#9C90FF] text-[15px] font-semibold text-[#09090c] transition-colors hover:bg-[#B6ACFF] disabled:opacity-70"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      </AuthCard>

      <p className="mt-6 text-center text-[14px] text-[#9B9BA8]">
        <Link href="/sign-in" className="font-medium text-[#9C90FF] hover:text-[#B6ACFF]">
          Back to sign in
        </Link>
      </p>
    </>
  )
}
