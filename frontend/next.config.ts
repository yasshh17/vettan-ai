import type { NextConfig } from "next";

// Origins the app actually talks to, so connect-src isn't left wide open.
// Both are public by design (anon key / public API base), so no secret
// leaks by including them in a header value.
const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""

// A malformed value here (e.g. a botched env-var paste that concatenates the
// URL with the next KEY=VALUE line) doesn't fail loudly on its own: it just
// isn't a valid CSP source expression, so the browser silently drops it from
// connect-src and every Supabase call gets blocked in production instead.
// Fail the build instead so this surfaces at deploy time, not in a user's
// console.
const HOSTNAME_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

if (rawSupabaseUrl) {
  let isValid = false
  try {
    const parsed = new URL(rawSupabaseUrl)
    // `new URL()` is lenient about host content (it happily accepts
    // "=" and "_"), which is exactly what lets a concatenated env var
    // slip through as a "valid" URL. Require an actual hostname shape
    // and no leftover path/query/hash, since a Supabase project URL is
    // just a bare origin.
    isValid =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      HOSTNAME_PATTERN.test(parsed.hostname) &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
  } catch {
    isValid = false
  }
  if (!isValid) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL is not a valid Supabase project URL: "${rawSupabaseUrl}". ` +
        "Check the environment variable value for stray extra content " +
        "(a common cause is pasting multiple KEY=VALUE lines into one field)."
    )
  }
} else if (process.env.VERCEL_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL is not set for this production build."
  )
}

const SUPABASE_ORIGIN = rawSupabaseUrl
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// Next.js injects small inline bootstrap scripts (hydration data, etc.)
// without a nonce today, so 'unsafe-inline' on script-src is required for
// the app to run at all. This CSP is still real defense in depth: it blocks
// loading script/style/frame/object content from any *other* origin, which
// is exactly the shape of payload the XSS fix in page.tsx was guarding
// against (an injected <img onerror=...> can still fire inline, but a
// fetch()/img/script pointed at an attacker-controlled host is blocked).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE_ORIGIN} ${API_ORIGIN}`,
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
