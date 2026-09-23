"use client"

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import type { User } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/client"
import { signOutAndReset } from "@/lib/sign-out"
import { api } from "@/lib/api"
import { initials } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User
}

const inputClass =
  "border-neutral-700 bg-neutral-950/60 text-neutral-100 placeholder:text-neutral-600 focus-visible:border-purple-500 focus-visible:ring-2 focus-visible:ring-purple-500/30"

const primaryButtonClass = "bg-purple-600 text-white hover:bg-purple-700"

function mapAuthError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "That email is already in use."
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "Too many attempts. Wait a bit and try again."
  }
  return message || fallback
}

export function SettingsDialog({ open, onOpenChange, user }: SettingsDialogProps) {
  const { toast } = useToast()

  const currentName = (user.user_metadata?.full_name as string) || ""
  const email = user.email ?? ""

  const [name, setName] = useState(currentName)
  const [savingName, setSavingName] = useState(false)

  const [changingEmail, setChangingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [sendingEmailChange, setSendingEmailChange] = useState(false)

  const [deleteStep, setDeleteStep] = useState<"idle" | "confirming">("idle")
  const [confirmEmailInput, setConfirmEmailInput] = useState("")
  const [deleting, setDeleting] = useState(false)

  const resetTransientState = () => {
    setName(currentName)
    setChangingEmail(false)
    setNewEmail("")
    setDeleteStep("idle")
    setConfirmEmailInput("")
  }

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
    if (!next) resetTransientState()
  }

  const handleSaveName = async () => {
    setSavingName(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name.trim() },
      })
      if (error) throw error
      toast({ title: "Profile updated", description: "Your name has been saved." })
    } catch (err) {
      toast({
        title: "Couldn't update your name",
        description: mapAuthError(err, "Something went wrong. Try again."),
        variant: "destructive",
      })
    } finally {
      setSavingName(false)
    }
  }

  const handleSendEmailChange = async () => {
    setSendingEmailChange(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() })
      if (error) throw error
      toast({
        title: "Confirmation email sent",
        description: `Check your inbox at ${newEmail.trim()} to confirm the change. Your email won't update until you confirm.`,
      })
      setChangingEmail(false)
      setNewEmail("")
    } catch (err) {
      toast({
        title: "Couldn't change your email",
        description: mapAuthError(err, "Something went wrong. Try again."),
        variant: "destructive",
      })
    } finally {
      setSendingEmailChange(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        toast({
          title: "Session expired",
          description: "Sign in again and retry.",
          variant: "destructive",
        })
        setDeleting(false)
        return
      }

      await api.deleteAccount(session.access_token)

      toast({
        title: "Account deleted",
        description: "You've been signed out. We're sorry to see you go.",
      })
      handleOpenChange(false)
      // The auth user is gone, so the server may reject the sign-out. Drop the
      // local session and this tab's cached data regardless.
      await signOutAndReset({ ignoreErrors: true })
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      let description = "Something went wrong. Try again, or contact support if this keeps happening."
      if (status === 401) description = "Your session expired. Sign in again and retry."
      if (status === 503) description = "Account deletion isn't available right now. Contact support."
      toast({ title: "Couldn't delete your account", description, variant: "destructive" })
      setDeleting(false)
    }
  }

  const nameChanged = name.trim() !== currentName.trim() && name.trim().length > 0
  const newEmailValid =
    newEmail.trim().length > 0 &&
    newEmail.includes("@") &&
    newEmail.trim().toLowerCase() !== email.toLowerCase()
  const confirmMatches =
    confirmEmailInput.trim().toLowerCase() === email.toLowerCase() && email.length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage your profile and account
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-purple-600 text-lg font-semibold text-white">
            {initials(currentName || email)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-100">
              {currentName || email}
            </p>
            <p className="truncate text-xs text-neutral-500">{email}</p>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-300" htmlFor="settings-name">
              Full name
            </label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={inputClass}
            />
            {nameChanged && (
              <div className="flex justify-end">
                <Button onClick={handleSaveName} disabled={savingName} className={primaryButtonClass}>
                  {savingName && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-300">Email</label>
            {!changingEmail ? (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-neutral-200">{email}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setChangingEmail(true)}
                  className="text-neutral-200 hover:text-white"
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
                <label className="text-xs font-medium text-neutral-400" htmlFor="settings-new-email">
                  New email address
                </label>
                <Input
                  id="settings-new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setChangingEmail(false)
                      setNewEmail("")
                    }}
                    disabled={sendingEmailChange}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSendEmailChange}
                    disabled={!newEmailValid || sendingEmailChange}
                    className={primaryButtonClass}
                  >
                    {sendingEmailChange && <Loader2 className="h-4 w-4 animate-spin" />}
                    Send confirmation link
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <Separator className="my-8 bg-neutral-800" />

        <div className="space-y-3">
          <Alert variant="destructive" className="border-red-900/50 bg-red-950/20">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <AlertTitle className="text-red-200">Delete account</AlertTitle>
            <AlertDescription className="text-red-300/90">
              This permanently deletes your Vettan account and signs you out everywhere.
              This can&apos;t be undone.
            </AlertDescription>
          </Alert>

          {deleteStep === "idle" ? (
            <div className="flex justify-end">
              <Button variant="destructive" onClick={() => setDeleteStep("confirming")}>
                Delete account
              </Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-red-900/50 bg-red-950/10 p-3">
              <label className="text-sm text-neutral-200" htmlFor="settings-delete-confirm">
                Type your email address to confirm
              </label>
              <p className="text-xs text-neutral-500">
                This is permanent. There&apos;s no way to get your account back.
              </p>
              <Input
                id="settings-delete-confirm"
                value={confirmEmailInput}
                onChange={(e) => setConfirmEmailInput(e.target.value)}
                placeholder={email}
                className="border-neutral-700 bg-neutral-950/60 text-neutral-100 placeholder:text-neutral-600 focus-visible:border-red-500 focus-visible:ring-2 focus-visible:ring-red-500/30"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeleteStep("idle")
                    setConfirmEmailInput("")
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteAccount}
                  disabled={!confirmMatches || deleting}
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Delete my account
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
