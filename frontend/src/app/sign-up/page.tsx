import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignUpForm } from "@/components/auth/sign-up-form"

export const metadata: Metadata = {
  title: "Sign up — Vettan",
  description: "Create your Vettan account.",
}

export default function SignUpPage() {
  return (
    <AuthShell mode="sign-up" title="Create your account" subtitle="Start using Vettan in a minute">
      <SignUpForm />
    </AuthShell>
  )
}
