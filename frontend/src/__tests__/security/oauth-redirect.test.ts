/**
 * The OAuth callback must only redirect to same-site relative paths: `?next=//evil.com`
 * would otherwise send a freshly signed-in user off-site.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: null } })),
    },
    from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })),
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

  it("sends password-recovery links to /reset-password", async () => {
    const res = await GET(callbackRequest("next=%2Freset-password"))
    expect(res.headers.get("location")).toBe("https://app.example.com/reset-password")
  })

  it("defaults to /app when next is absent", async () => {
    const res = await GET(callbackRequest(""))
    expect(res.headers.get("location")).toBe("https://app.example.com/app")
  })
})
