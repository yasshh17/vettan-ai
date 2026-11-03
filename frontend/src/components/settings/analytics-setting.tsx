"use client"

import { useEffect, useState } from "react"

import { useToast } from "@/hooks/use-toast"
import {
  WITHDRAWAL_NOTE,
  WITHDRAWAL_PENDING,
  getConsent,
  saveConsent,
  type ConsentStatus,
} from "@/lib/analytics-consent"

export function AnalyticsSetting({ open }: { open: boolean }) {
  const { toast } = useToast()
  const [status, setStatus] = useState<ConsentStatus | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getConsent()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const toggle = async () => {
    if (!status) return
    setSaving(true)
    try {
      setStatus(await saveConsent(!status.granted, "settings"))
    } catch {
      toast({
        title: "Couldn't save that",
        description: "Your setting hasn't changed. Try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const granted = status?.granted ?? false

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span id="settings-analytics-label" className="text-sm font-medium text-neutral-200">
          Product analytics
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={granted}
          aria-labelledby="settings-analytics-label"
          disabled={!status || saving || (!granted && status.erasure_pending)}
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 disabled:opacity-50 ${
            granted ? "bg-purple-600" : "bg-neutral-700"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              granted ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>
      <p className="text-sm text-neutral-500">{WITHDRAWAL_NOTE}</p>
      {status?.erasure_pending && <p className="text-sm text-neutral-300">{WITHDRAWAL_PENDING}</p>}
    </div>
  )
}
