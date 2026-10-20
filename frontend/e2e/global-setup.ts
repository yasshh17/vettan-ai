import { readFileSync } from "node:fs"
import path from "node:path"

// Refuses to run if the served app still carries the real Supabase host from .env.local,
// in the page or in any script it loads. The host is compared, never printed.
export default async function globalSetup() {
  const origin = "http://127.0.0.1:3100"
  let realHost = ""
  try {
    const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
    const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim()
    if (url) realHost = new URL(url).hostname
  } catch {
    // No .env.local: nothing real to leak.
  }

  const res = await fetch(`${origin}/preview/landing`)
  // The server builds its CSP connect-src from the Supabase URL it was started with.
  const csp = res.headers.get("content-security-policy") ?? ""
  if (!csp.includes("http://127.0.0.1:9") || (realHost && csp.includes(realHost))) {
    throw new Error("e2e: the server isn't using the dummy Supabase origin; refusing to run")
  }
  const html = await res.text()
  if (!html.includes("Think deeper.")) throw new Error("e2e: /preview/landing did not render (is LANDING_PREVIEW set?)")
  // The homepage is Landing v62 too, with no preview flag involved.
  const home = await (await fetch(`${origin}/`)).text()
  if (!home.includes("How Vettan works") || home.includes("Vettan reasons before it answers")) {
    throw new Error("e2e: / is not rendering Landing v62")
  }
  const scripts = [...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1])
  const bodies = [html, ...(await Promise.all(scripts.map(async (s) => (await fetch(origin + s)).text())))]
  // (supabase-js ships doc comments with example *.supabase.co URLs, so match the real host.)
  if (realHost && bodies.some((body) => body.includes(realHost))) {
    throw new Error("e2e: the served app references the real Supabase project; refusing to run")
  }
}
