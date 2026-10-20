// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { DENSITY_VH, isLandingPreviewEnabled, parseDensity } from "@/lib/landing-preview"

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/components/landing-v2/landing-v2", () => ({ LandingV2: () => null }))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("landing preview gate", () => {
  it("is off unless the flag is set", () => {
    expect(isLandingPreviewEnabled({})).toBe(false)
    expect(isLandingPreviewEnabled({ LANDING_PREVIEW: "true" })).toBe(false)
    expect(isLandingPreviewEnabled({ LANDING_PREVIEW: "1" })).toBe(true)
    expect(isLandingPreviewEnabled({ LANDING_PREVIEW: "1", VERCEL_ENV: "preview" })).toBe(true)
  })

  it("is never on in production, even with the flag", () => {
    expect(isLandingPreviewEnabled({ LANDING_PREVIEW: "1", VERCEL_ENV: "production" })).toBe(false)
  })

  it("renders 404 without the flag", async () => {
    vi.stubEnv("LANDING_PREVIEW", "")
    const { default: Page } = await import("@/app/preview/landing/page")
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders 404 on production with the flag", async () => {
    vi.stubEnv("LANDING_PREVIEW", "1")
    vi.stubEnv("VERCEL_ENV", "production")
    const { default: Page } = await import("@/app/preview/landing/page")
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("waits for a request before deciding, and renders when enabled", async () => {
    vi.stubEnv("LANDING_PREVIEW", "1")
    vi.stubEnv("VERCEL_ENV", "preview")
    const { connection } = await import("next/server")
    const { default: Page } = await import("@/app/preview/landing/page")
    const el = await Page({ searchParams: Promise.resolve({ density: "compact" }) })
    expect(connection).toHaveBeenCalled()
    expect(el.props.density).toBe("compact")
  })

  it("asks search engines not to index it", async () => {
    const { metadata } = await import("@/app/preview/landing/page")
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
  })
})

describe("story density presets", () => {
  it("maps presets to step heights and falls back to default", () => {
    expect(DENSITY_VH).toEqual({ compact: 45, default: 55, relaxed: 65 })
    expect(parseDensity("compact")).toBe("compact")
    expect(parseDensity(["relaxed"])).toBe("relaxed")
    expect(parseDensity("huge")).toBe("default")
    expect(parseDensity(undefined)).toBe("default")
  })
})
