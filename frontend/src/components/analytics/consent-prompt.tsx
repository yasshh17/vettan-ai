"use client"

import { useEffect, useState } from "react"

import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CONSENT_LABEL,
  WITHDRAWAL_DONE,
  ackErasureNotice,
  getConsent,
  saveConsent,
} from "@/lib/analytics-consent"
import { createClient } from "@/lib/supabase/client"

const CHOICE_CLASS = "flex-1 bg-neutral-800 text-neutral-100 hover:bg-neutral-700"

// The sign-up callback's save gives up while a sleeping backend wakes, so save
// the choice from the sign-up box here rather than ask again.
async function savedSignUpChoice() {
  try {
    const { data } = await createClient().auth.getSession()
    const choice = data.session?.user?.user_metadata?.analytics_consent
    if (typeof choice !== "boolean") return false
    await saveConsent(choice, "signup")
    return true
  } catch {
    return false
  }
}

// Asks accounts with no decision, and shows the notice when a withdrawal's erase
// finishes. Closing without a choice saves nothing; it asks again next session.
export function ConsentPrompt() {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getConsent()
      .then(async (status) => {
        if (cancelled) return
        if (status.decided === false && !(await savedSignUpChoice())) {
          if (!cancelled) setOpen(true)
        }
        if (status.erasure_completed) {
          toast({ title: "Product analytics", description: WITHDRAWAL_DONE })
          ackErasureNotice().catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [toast])

  const choose = async (granted: boolean) => {
    setSaving(true)
    try {
      await saveConsent(granted, "prompt")
      setOpen(false)
    } catch {
      toast({
        title: "Couldn't save your choice",
        description: "We'll ask again next time.",
        variant: "destructive",
      })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Enter shouldn't grant consent, so neither choice starts focused. */}
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Product analytics</DialogTitle>
          <DialogDescription>{CONSENT_LABEL}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3">
          <Button className={CHOICE_CLASS} disabled={saving} onClick={() => choose(true)}>
            Yes, that&apos;s fine
          </Button>
          <Button className={CHOICE_CLASS} disabled={saving} onClick={() => choose(false)}>
            No thanks
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
