import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata: Metadata = {
  title: "Set a new password — Vettan",
  description: "Choose a new password for your Vettan account.",
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      mode="reset-password"
      title="Set a new password"
      subtitle="Choose a new password for your account"
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
