import type { NextConfig } from "next";

// Origins for connect-src. Both are public values.
const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""

// Fail the build on a malformed origin: the browser would silently drop it from
// connect-src and block every Supabase call in production.
const HOSTNAME_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

if (rawSupabaseUrl) {
  let isValid = false
  try {
    const parsed = new URL(rawSupabaseUrl)
    // new URL() accepts "=" and "_" in hosts, so a pasted KEY=VALUE slips through.
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

// 'unsafe-inline' is needed for Next's un-nonced bootstrap scripts. The CSP still
// blocks loading content from other origins.
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
