// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/landing-v3/landing-v3", () => ({ LandingV3: () => null }))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("homepage route", () => {
  it("renders Landing v3, with no preview flag", async () => {
    vi.stubEnv("LANDING_PREVIEW", "")
    const { default: Page } = await import("@/app/page")
    const { LandingV3 } = await import("@/components/landing-v3/landing-v3")
    expect(Page().type).toBe(LandingV3)
  })

  it("renders it on production too: the homepage isn't gated", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    const { default: Page } = await import("@/app/page")
    const { LandingV3 } = await import("@/components/landing-v3/landing-v3")
    expect(Page().type).toBe(LandingV3)
  })

  it("has indexable metadata that says what the pipeline really does", async () => {
    const { metadata } = await import("@/app/page")
    const text = `${metadata.title} ${metadata.description}`
    expect(metadata.title).toBe("Vettan · Research you can check.")
    expect(text).toMatch(/reads excerpts from the most relevant pages/)
    expect(text).not.toMatch(/ReAct|multi-agent|verif|reads the most relevant (sources|pages)/i)
    expect(metadata.robots).toBeUndefined()
  })

  it("keeps the previous homepage recoverable", async () => {
    const legacy = await import("@/components/landing/legacy-home")
    expect(typeof legacy.LegacyHome).toBe("function")
    expect(legacy.LEGACY_HOME_METADATA.title).toBe("Vettan — ReAct-based multi-agent research")
  })
})
