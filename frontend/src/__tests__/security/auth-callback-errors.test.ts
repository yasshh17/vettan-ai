/**
 * Failed email links (expired, already used, or a failed code exchange) must
 * land on /sign-in?error=link_invalid so the sign-in page can explain what
 * happened, instead of silently dropping the user on the sign-in form.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const exchangeCodeForSession = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { exchangeCodeForSession } })),
}))

const { GET } = await import("@/app/auth/callback/route")

describe("auth callback error handling", () => {
  beforeEach(() => exchangeCodeForSession.mockReset())

  it("redirects to link_invalid when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid flow state") })
    const res = await GET(new Request("https://app.example.com/auth/callback?code=abc123"))
    expect(res.headers.get("location")).toBe("https://app.example.com/sign-in?error=link_invalid")
  })

  it("redirects to link_invalid when Supabase reports an expired link", async () => {
    const res = await GET(
      new Request(
        "https://app.example.com/auth/callback?error=access_denied&error_code=otp_expired"
      )
    )
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(res.headers.get("location")).toBe("https://app.example.com/sign-in?error=link_invalid")
  })
})
