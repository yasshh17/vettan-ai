import { NextResponse } from "next/server"
import { CONSENT_WORDING_VERSION } from "@/content/legal/meta"
import { createClient } from "@/lib/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// The backend ignores this once a decision exists, so a later password reset
// can't overturn it. If it fails, the app asks with the one-time prompt.
async function saveSignUpConsent(supabase: SupabaseClient, granted: boolean) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return
    await fetch(`${API_ORIGIN}/api/analytics/consent`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ granted, source: "signup", wording_version: CONSENT_WORDING_VERSION }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {}
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const requestedNext = searchParams.get("next")
  // Relative paths only, to prevent an open redirect ("//evil.com").
  const next =
    requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/app"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const dob = user?.user_metadata?.date_of_birth
      if (user && typeof dob === "string" && dob) {
        await supabase.from("profiles").upsert({ user_id: user.id, date_of_birth: dob })
      }
      const consent = user?.user_metadata?.analytics_consent
      if (typeof consent === "boolean") {
        await saveSignUpConsent(supabase, consent)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Expired or reused link, or a failed exchange. Sign-up emails are confirmed by now.
  return NextResponse.redirect(`${origin}/sign-in?error=link_invalid`)
}
