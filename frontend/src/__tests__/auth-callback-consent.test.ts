import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const metadata: { value: Record<string, unknown> } = { value: {} }
const upsert = vi.fn(async () => ({}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { id: "u1", user_metadata: metadata.value } } }),
      getSession: async () => ({ data: { session: { access_token: "token" } } }),
    },
    from: () => ({ upsert }),
  }),
}))

const { GET } = await import("@/app/auth/callback/route")
const fetchMock = vi.fn()

function callback() {
  return GET(new Request("https://vettan.test/auth/callback?code=abc&next=/app"))
}

beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("auth callback consent", () => {
  it("saves the sign-up choice with the session token", async () => {
    metadata.value = { analytics_consent: true }
    await callback()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/analytics\/consent$/)
    expect(init.method).toBe("PUT")
    expect(init.headers.Authorization).toBe("Bearer token")
    expect(JSON.parse(init.body)).toMatchObject({ granted: true, source: "signup" })
  })

  it("saves a declined box too, so the prompt doesn't ask again", async () => {
    metadata.value = { analytics_consent: false }
    await callback()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ granted: false })
  })

  it("does nothing for accounts with no sign-up choice", async () => {
    metadata.value = {}
    await callback()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("still lands in the app if saving fails, and the prompt asks instead", async () => {
    metadata.value = { analytics_consent: true }
    fetchMock.mockRejectedValue(new Error("network"))
    const response = await callback()
    expect(response.headers.get("location")).toBe("https://vettan.test/app")
  })
})
