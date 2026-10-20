import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installDomMocks } from "./dom-mocks"

const { ACTIVE_LINE, activeStep } = await import("@/components/landing-v2/story/research-story")
const { EvidenceStage } = await import("@/components/landing-v2/story/evidence-stage")
const { MOMENTS } = await import("@/components/landing-v2/story/moments")
const { useReducedMotion } = await import("@/components/landing-v2/use-reduced-motion")

describe("story scroll mapping", () => {
  it("activates a step once its top crosses 55% of the viewport", () => {
    expect(ACTIVE_LINE).toBe(0.55)
    const h = 1000
    expect(activeStep([600, 960, 1320], h)).toBe(0)
    expect(activeStep([100, 549, 900], h)).toBe(1)
    expect(activeStep([-800, -400, 551], h)).toBe(1)
    expect(activeStep([-800, -400, -10], h)).toBe(2)
  })

  it("keeps the approved v62 copy", () => {
    expect(MOMENTS.map((m) => m.title)).toEqual([
      "You ask in plain language",
      "It splits the question into focused searches",
      "The searches run in parallel",
      "The most relevant pages are kept",
      "The report is written from those pages",
      "Each cited point links back to its page",
    ])
  })
})

describe("evidence stage", () => {
  beforeEach(() => {
    installDomMocks()
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("keeps hidden layers out of the tab order and the accessibility tree", () => {
    render(<EvidenceStage moment={0} />)
    expect(screen.queryAllByRole("button", { name: /^Citation/ })).toHaveLength(0)
    const hidden = document.querySelectorAll("[data-stage-layer][aria-hidden='true']")
    hidden.forEach((el) => expect(el).toHaveAttribute("inert"))
  })

  it("Result: selecting the IBM citation swaps the chip's monogram for a check without resizing it", () => {
    render(<EvidenceStage moment={5} />)
    const ibm = screen.getByRole("button", { name: "Citation: www.ibm.com. Show this source" })
    const chip = screen.getByRole("link", { name: /^www\.ibm\.com ×2/ })
    const slot = chip.querySelector("span[aria-hidden='true']")!
    expect(slot).toHaveTextContent("I")
    expect(slot.className).toContain("w-[11px]")
    act(() => ibm.click())
    expect(ibm).toHaveAttribute("aria-pressed", "true")
    expect(ibm.querySelector("[data-citation-check]")?.className).toContain("absolute")
    expect(slot).toHaveTextContent("")
    expect(slot.querySelector("svg")).not.toBeNull()
    expect(slot.className).toContain("w-[11px]")
    expect(chip).toHaveTextContent(", selected")
  })
})

describe("reduced motion", () => {
  it("follows the OS setting live, without a reload", () => {
    const mocks = installDomMocks({ reducedMotion: false })
    function Probe() {
      return <p>{useReducedMotion() ? "reduced" : "full"}</p>
    }
    render(<Probe />)
    expect(screen.getByText("full")).toBeInTheDocument()
    act(() => mocks.setReducedMotion(true))
    expect(screen.getByText("reduced")).toBeInTheDocument()
    cleanup()
  })
})
