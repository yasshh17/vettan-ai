import { readFileSync } from "node:fs"
import path from "node:path"

// Refuses to run unless the served app talks to the local Supabase and nothing real.
export default async function globalSetup() {
  const stack = JSON.parse(
    readFileSync(path.join(__dirname, "..", "..", "test-results", "supabase-e2e", "stack-env.json"), "utf8")
  ) as { apiUrl: string }

  let realHost = ""
  try {
    const env = readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8")
    const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim()
    if (url) realHost = new URL(url).hostname
  } catch {}

  const health = await fetch(`${stack.apiUrl}/auth/v1/health`, { headers: { apikey: "health" } }).catch(() => null)
  if (!health) throw new Error("auth e2e: local Supabase isn't reachable; run node e2e/auth/stack.mjs start")

  const res = await fetch("http://localhost:3101/preview/landing")
  const csp = res.headers.get("content-security-policy") ?? ""
  if (!csp.includes(stack.apiUrl) || (realHost && csp.includes(realHost))) {
    throw new Error("auth e2e: the app isn't configured for the local Supabase; refusing to run")
  }
  const html = await res.text()
  const scripts = [...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1])
  const bodies = await Promise.all(scripts.map(async (s) => (await fetch(`http://localhost:3101${s}`)).text()))
  if (realHost && [html, ...bodies].some((b) => b.includes(realHost))) {
    throw new Error("auth e2e: the app bundle references the real Supabase project; refusing to run")
  }
}
