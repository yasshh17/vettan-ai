/**
 * Regression test for the open-redirect finding from the 2026-09 security
 * audit (frontend/src/app/auth/callback/route.ts).
 *
 * The OAuth callback used to redirect to `${origin}${next}` where `next` was
 * whatever the caller passed in the `?next=` query param, unvalidated. A
 * value like `//evil.com` makes `${origin}${next}` become
 * `https://yoursite.com//evil.com`, which browsers resolve to `evil.com` -
 * sending a user who just authenticated straight to an attacker's site.
 *
 * The fix restricts `next` to same-site relative paths. This test drives the
 * real route handler (not a reimplementation of its logic) with a mocked
 * Supabase client, so it fails if the validation is ever loosened again.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    },
  })),
}))

// Imported after the mock so route.ts picks up the mocked createClient.
const { GET } = await import("@/app/auth/callback/route")

function callbackRequest(query: string) {
  return new Request(`https://app.example.com/auth/callback?code=abc123&${query}`)
}

describe("OAuth callback redirect (open-redirect regression)", () => {
  it("rejects a protocol-relative next (//evil.com) and falls back to /app", async () => {
    const res = await GET(callbackRequest("next=%2F%2Fevil.com"))
    const location = res.headers.get("location")
    expect(location).toBe("https://app.example.com/app")
  })

  it("rejects an absolute external next (https://evil.com)", async () => {
    const res = await GET(callbackRequest("next=https%3A%2F%2Fevil.com"))
    const location = res.headers.get("location")
    expect(location).not.toContain("evil.com")
    expect(location).toBe("https://app.example.com/app")
  })

  it("still allows a legitimate same-site relative next", async () => {
    const res = await GET(callbackRequest("next=%2Fapp%2Fsettings"))
    expect(res.headers.get("location")).toBe("https://app.example.com/app/settings")
  })

  it("defaults to /app when next is absent", async () => {
    const res = await GET(callbackRequest(""))
    expect(res.headers.get("location")).toBe("https://app.example.com/app")
  })
})
