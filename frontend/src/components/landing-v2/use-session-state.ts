"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { createClient as createClientType } from "@/lib/supabase/client"

export type SessionState = "unknown" | "signedIn" | "signedOut"

export interface Session {
  state: SessionState
  // The signed-in user's id; null when signed out or not known yet.
  userId: string | null
}

// The Supabase client is ~65 KB gzipped; the landing page only needs it after hydration,
// so it's loaded once, on demand, instead of with the page.
let client: Promise<ReturnType<typeof createClientType>> | null = null
const loadClient = () => (client ??= import("@/lib/supabase/client").then((m) => m.createClient()))

const UNKNOWN: Session = { state: "unknown", userId: null }
const fromSession = (session: { user?: { id?: string } } | null): Session =>
  session ? { state: "signedIn", userId: session.user?.id ?? null } : { state: "signedOut", userId: null }

// Follows sign-in and sign-out live, including from other tabs. `resolve` waits for the
// first lookup so an action never branches on "unknown".
export function useSessionState(): Session & { resolve: () => Promise<Session> } {
  const [session, setSession] = useState<Session>(UNKNOWN)
  const first = useRef<Promise<Session> | null>(null)

  const lookup = useCallback(() => {
    if (!first.current) {
      first.current = (async (): Promise<Session> => {
        try {
          const { data } = await (await loadClient()).auth.getSession()
          return fromSession(data.session)
        } catch {
          return { state: "signedOut", userId: null }
        }
      })()
    }
    return first.current
  }, [])

  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    lookup().then((s) => {
      if (active) setSession((prev) => (prev.state === "unknown" ? s : prev))
    })
    loadClient()
      .then((client) => {
        if (!active) return
        const { data } = client.auth.onAuthStateChange((_event, s) => {
          if (active) setSession(fromSession(s))
        })
        unsubscribe = () => data.subscription.unsubscribe()
      })
      .catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
  }, [lookup])

  const resolve = useCallback(async () => (session.state === "unknown" ? lookup() : session), [session, lookup])

  return { ...session, resolve }
}
