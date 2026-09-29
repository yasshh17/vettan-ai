"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthCard } from "@/components/auth/auth-card"
import { AuthField } from "@/components/auth/auth-field"
import { validatePassword, validatePasswordConfirmation } from "@/components/auth/validation"

type Status = "checking" | "ready" | "invalid" | "success"

export function ResetPasswordForm() {
  const [status, setStatus] = useState<Status>("checking")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<{ password?: string | null; confirmPassword?: string | null }>({})
  const [formError, setFormError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus((current) => (current === "checking" ? (session ? "ready" : "invalid") : current))
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setStatus("ready")
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const passwordError = validatePassword(password)
    const confirmError = validatePasswordConfirmation(password, confirmPassword)
    if (passwordError || confirmError) {
      setErrors({ password: passwordError, confirmPassword: confirmError })
      return
    }
    setErrors({})
    setFormError("")
    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setFormError(error.message)
        setLoading(false)
        return
      }

      await supabase.auth.signOut({ scope: "global" })
      setStatus("success")
    } catch {
      setFormError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  if (status === "checking") {
    return (
      <AuthCard className="flex flex-col items-center text-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#9C90FF]" />
      </AuthCard>
    )
  }

  if (status === "invalid") {
    return (
      <>
        <AuthCard className="flex flex-col items-center text-center">
          <h2 className="text-[20px] font-semibold text-[#EDEDF2]">Link expired</h2>
          <p className="mt-2 text-[15px] text-[#9B9BA8]">
            This password reset link is invalid or has expired.
          </p>
        </AuthCard>

        <p className="mt-6 text-center text-[14px] text-[#9B9BA8]">
          <Link href="/forgot-password" className="font-medium text-[#9C90FF] hover:text-[#B6ACFF]">
            Request a new link
          </Link>
        </p>
      </>
    )
  }

  if (status === "success") {
    return (
      <>
        <AuthCard className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(124,111,240,0.12)]">
            <CheckCircle2 className="h-6 w-6 text-[#9C90FF]" />
          </div>
          <h2 className="mt-5 text-[20px] font-semibold text-[#EDEDF2]">Password updated</h2>
          <p className="mt-2 text-[15px] text-[#9B9BA8]">
            Your password has been changed. Sign in with your new password.
          </p>
        </AuthCard>

        <p className="mt-6 text-center text-[14px] text-[#9B9BA8]">
          <Link href="/sign-in" className="font-medium text-[#9C90FF] hover:text-[#B6ACFF]">
            Sign in
          </Link>
        </p>
      </>
    )
  }

  return (
    <AuthCard>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {formError && (
          <div className="rounded-lg border border-[#f87171]/30 bg-[#1e1a1a] px-4 py-3 text-[14px] text-[#f87171]">
            {formError}
          </div>
        )}

        <AuthField
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />

        <AuthField
          id="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={errors.confirmPassword}
        />

        <button
          type="submit"
          disabled={loading}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-[#9C90FF] text-[15px] font-semibold text-[#09090c] transition-colors hover:bg-[#B6ACFF] disabled:opacity-70"
        >
          {loading && <Loader2 className="h-5 w-5 animate-spin" />}
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthCard>
  )
}
