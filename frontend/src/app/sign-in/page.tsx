import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignInForm } from "@/components/auth/sign-in-form"

export const metadata: Metadata = {
  title: "Sign in — Vettan",
  description: "Sign in to Vettan.",
}

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid:
    "That link is invalid or has expired. If you just confirmed your email, sign in with your password.",
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const initialError = (error && ERROR_MESSAGES[error]) || ""

  return (
    <AuthShell mode="sign-in" title="Welcome back" subtitle="Sign in to continue to Vettan">
      <SignInForm initialError={initialError} />
    </AuthShell>
  )
}
