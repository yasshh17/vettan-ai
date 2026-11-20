"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

import { consentState, getConsent, onConsentChange } from "@/lib/analytics-consent"
import { routeName, track, trackingAllowed } from "@/lib/analytics"
import { getAccessToken } from "@/lib/auth-fetch"

// Records page views once consent is known. A signed-out visitor causes no request.
export function UsageTracker() {
  const pathname = usePathname()
  const consent = useSyncExternalStore(onConsentChange, consentState, () => "unknown" as const)
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (!trackingAllowed() || consentState() !== "unknown") return
    getAccessToken()
      .then((token) => (token ? getConsent() : null))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (consent !== "granted") {
      lastPath.current = null
      return
    }
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    track("page_viewed", { route: routeName(pathname) })
  }, [consent, pathname])

  return null
}
