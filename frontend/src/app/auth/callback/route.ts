import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Expired or reused link, or a failed exchange. Sign-up emails are confirmed by now.
  return NextResponse.redirect(`${origin}/sign-in?error=link_invalid`)
}
