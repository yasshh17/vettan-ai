import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PROTECTED_PREFIXES = ["/app"]
const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password"]

export async function updateSession(request: NextRequest) {
  // Supabase sends email links to the Site URL root when the requested redirect isn't
  // allowlisted. Hand them to /auth/callback, which exchanges the code or reports the error.
  const { pathname: path, searchParams } = request.nextUrl
  if (path === "/" && (searchParams.has("code") || searchParams.has("error_code"))) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/callback"
    if (!url.searchParams.has("next")) url.searchParams.set("next", "/app")
    return NextResponse.redirect(url)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { pathname } = request.nextUrl
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))

  let user = null
  try {
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser()
    user = fetchedUser
  } catch {
    // Fail closed: never serve /app when the session can't be checked.
    if (isProtected) {
      const url = request.nextUrl.clone()
      url.pathname = "/sign-in"
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = "/sign-in"
    return NextResponse.redirect(url)
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/app"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
