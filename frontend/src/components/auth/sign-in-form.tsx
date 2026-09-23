"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthCard } from "@/components/auth/auth-card"
import { AuthField } from "@/components/auth/auth-field"
import { GoogleButton } from "@/components/auth/google-button"
import { validateEmail, validatePassword } from "@/components/auth/validation"

export function SignInForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({})
  const [formError, setFormError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)
    if (emailError || passwordError) {
      setErrors({ email: emailError, password: passwordError })
      return
    }
    setErrors({})
    setFormError("")
    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        setFormError("Invalid email or password.")
        setLoading(false)
        return
      }

      router.push("/app")
      router.refresh()
    } catch {
      setFormError("Something went wrong. Please try again.")
      setLoading(false)
    }
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
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            rightSlot={
              <Link href="/sign-in" className="text-[13px] font-medium text-[#9C90FF] hover:text-[#B6ACFF]">
                Forgot password?
              </Link>
            }
          />

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-[#9C90FF] text-[15px] font-semibold text-[#09090c] transition-colors hover:bg-[#B6ACFF] disabled:opacity-70"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </AuthCard>

      <p className="mt-6 text-center text-[14px] text-[#9B9BA8]">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="font-medium text-[#9C90FF] hover:text-[#B6ACFF]">
          Sign up
        </Link>
      </p>
    </>
  )
}
