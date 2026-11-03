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

const CHOICE_CLASS = "flex-1 bg-neutral-800 text-neutral-100 hover:bg-neutral-700"

// Asks accounts with no decision, and shows the notice when a withdrawal's erase
// finishes. Closing without a choice saves nothing; it asks again next session.
export function ConsentPrompt() {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getConsent()
      .then((status) => {
        if (cancelled) return
        if (status.decided === false) setOpen(true)
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
      <DialogContent>
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
