import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignInForm } from "@/components/auth/sign-in-form"

export const metadata: Metadata = {
  title: "Sign in — Vettan",
  description: "Sign in to Vettan.",
}

export default function SignInPage() {
  return (
    <AuthShell mode="sign-in" title="Welcome back" subtitle="Sign in to continue to Vettan">
      <SignInForm />
    </AuthShell>
  )
}
