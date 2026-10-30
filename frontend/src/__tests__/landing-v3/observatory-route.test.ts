// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/components/landing-v3/landing-v3", () => ({ LandingV3: () => null }))
vi.mock("@/components/landing-v2/landing-v2", () => ({ LandingV2: () => null }))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("observatory preview route", () => {
  it("renders 404 without the flag", async () => {
    vi.stubEnv("LANDING_PREVIEW", "")
    const { default: Page } = await import("@/app/preview/observatory/page")
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders 404 on production, even with the flag", async () => {
    vi.stubEnv("LANDING_PREVIEW", "1")
    vi.stubEnv("VERCEL_ENV", "production")
    const { default: Page } = await import("@/app/preview/observatory/page")
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders Landing v3 when enabled, deciding per request", async () => {
    vi.stubEnv("LANDING_PREVIEW", "1")
    vi.stubEnv("VERCEL_ENV", "preview")
    const { connection } = await import("next/server")
    const { default: Page } = await import("@/app/preview/observatory/page")
    const { LandingV3 } = await import("@/components/landing-v3/landing-v3")
    const el = await Page()
    expect(connection).toHaveBeenCalled()
    expect(el.type).toBe(LandingV3)
  })

  it("asks search engines not to index it", async () => {
    const { metadata } = await import("@/app/preview/observatory/page")
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
  })

  it("leaves the homepage on Landing v62", async () => {
    const { default: Home } = await import("@/app/page")
    const { LandingV2 } = await import("@/components/landing-v2/landing-v2")
    expect(Home().type).toBe(LandingV2)
  })
})
