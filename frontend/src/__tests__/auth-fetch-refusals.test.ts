// 429s and spend-guard 503s become RateLimitedError; other 503s pass through.
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  }),
}))

const { authFetch, CapacityError, RateLimitedError, limitTitle } = await import("@/lib/auth-fetch")

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers }))
  )
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return null
}

describe("authFetch refusals", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("turns the daily-limit 429 into a RateLimitedError with limit 'user'", async () => {
    respond(429, { detail: "You've reached today's usage limit. It resets in 5h 12m." }, {
      "retry-after": "18720",
      "x-spend-limit": "user",
    })
    const error = await caught(authFetch("/api/research/stream"))
    expect(error).toBeInstanceOf(RateLimitedError)
    expect((error as InstanceType<typeof RateLimitedError>).limit).toBe("user")
    expect((error as Error).message).toContain("resets in 5h 12m")
    expect(limitTitle(error as InstanceType<typeof RateLimitedError>)).toBe("Daily limit reached")
  })

  it("keeps an ordinary rate-limit 429 as before", async () => {
    respond(429, { detail: "Rate limit reached. Try again in 5 seconds." }, { "retry-after": "5" })
    const error = await caught(authFetch("/api/research/stream"))
    expect(error).toBeInstanceOf(RateLimitedError)
    expect((error as InstanceType<typeof RateLimitedError>).limit).toBeNull()
    expect(limitTitle(error as InstanceType<typeof RateLimitedError>)).toBe("Slow down a moment")
  })

  it("turns a spend-guard 503 into a CapacityError", async () => {
    respond(503, { detail: "Vettan has reached its capacity for today. Please try again later." }, {
      "x-spend-limit": "global",
    })
    const error = await caught(authFetch("/api/research/stream"))
    expect(error).toBeInstanceOf(CapacityError)
    expect(error).toBeInstanceOf(RateLimitedError)
    expect(limitTitle(error as InstanceType<typeof RateLimitedError>)).toBe("Research unavailable")
  })

  it("passes any other 503 through untouched", async () => {
    respond(503, { detail: "Account deletion is not configured." })
    const res = await authFetch("/api/account", { method: "DELETE" })
    expect(res.status).toBe(503)
  })
})
