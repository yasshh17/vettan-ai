// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/landing-v2/landing-v2", () => ({ LandingV2: () => null }))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("homepage route", () => {
  it("renders Landing v62 with the default density, with no preview flag", async () => {
    vi.stubEnv("LANDING_PREVIEW", "")
    const { default: Page } = await import("@/app/page")
    const { LandingV2 } = await import("@/components/landing-v2/landing-v2")
    const el = Page()
    expect(el.type).toBe(LandingV2)
    expect(el.props).toEqual({ density: "default" })
  })

  it("renders it on production too: the homepage isn't gated", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    const { default: Page } = await import("@/app/page")
    const { LandingV2 } = await import("@/components/landing-v2/landing-v2")
    expect(Page().type).toBe(LandingV2)
  })

  it("has indexable metadata without the retired claims", async () => {
    const { metadata } = await import("@/app/page")
    const text = `${metadata.title} ${metadata.description}`
    expect(metadata.title).toBe("Vettan · Think deeper. Discover faster.")
    expect(text).not.toMatch(/ReAct|multi-agent|verif/i)
    expect(metadata.robots).toBeUndefined()
  })

  it("keeps the previous homepage recoverable", async () => {
    const legacy = await import("@/components/landing/legacy-home")
    expect(typeof legacy.LegacyHome).toBe("function")
    expect(legacy.LEGACY_HOME_METADATA.title).toBe("Vettan — ReAct-based multi-agent research")
  })
})
