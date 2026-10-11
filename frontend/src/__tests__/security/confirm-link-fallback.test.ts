// @vitest-environment node
// Supabase sends email links to the Site URL root when the requested redirect isn't
// allowlisted. Those must still reach /auth/callback, not the landing page.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const getUser = vi.fn()

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}))

const { updateSession } = await import("@/lib/supabase/middleware")

describe("email link landing on the site root", () => {
  beforeEach(() => {
    getUser.mockReset()
    getUser.mockResolvedValue({ data: { user: null } })
  })

  it("forwards ?code= to /auth/callback with next=/app", async () => {
    const res = await updateSession(new NextRequest("https://app.example.com/?code=abc123"))
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/auth/callback?code=abc123&next=%2Fapp"
    )
  })

  it("forwards an expired-link error so the callback can report it", async () => {
    const res = await updateSession(
      new NextRequest("https://app.example.com/?error=access_denied&error_code=otp_expired")
    )
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/auth/callback?error=access_denied&error_code=otp_expired&next=%2Fapp"
    )
  })

  it("keeps an existing next", async () => {
    const res = await updateSession(
      new NextRequest("https://app.example.com/?code=abc123&next=%2Fapp%2Fsettings")
    )
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/auth/callback?code=abc123&next=%2Fapp%2Fsettings"
    )
  })

  it("leaves the landing page alone without auth params", async () => {
    const res = await updateSession(new NextRequest("https://app.example.com/"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("only applies to the root path", async () => {
    const res = await updateSession(new NextRequest("https://app.example.com/pricing?code=abc123"))
    expect(res.headers.get("location")).toBeNull()
  })
})
