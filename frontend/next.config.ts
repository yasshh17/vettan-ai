import type { NextConfig } from "next";

// Origins the app actually talks to, so connect-src isn't left wide open.
// Both are public by design (anon key / public API base), so no secret
// leaks by including them in a header value.
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
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
