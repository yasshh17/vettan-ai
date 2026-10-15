import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

// monitoring is the Sentry tunnel; it can't go through the auth redirect.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
