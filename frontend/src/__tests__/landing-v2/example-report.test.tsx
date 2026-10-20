import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installDomMocks } from "./dom-mocks"

const { ExampleReport } = await import("@/components/landing-v2/example-report")

beforeEach(() => {
  installDomMocks()
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const citations = () => screen.getAllByRole("button", { name: /^Citation: / })
const live = () => document.querySelector("[aria-live='polite']")!
const card = (rank: number) => document.getElementById(`source-${rank}`)!

describe("example report citations", () => {
  it("selects with a click, shows the check and Selected, and announces it", () => {
    render(<ExampleReport />)
    const [first] = citations()
    expect(first).toHaveAccessibleName("Citation: montecarlo.ai. Show this source")
    fireEvent.click(first)
    expect(first).toHaveAttribute("aria-pressed", "true")
    expect(first.querySelector("[data-citation-check]")).not.toBeNull()
    expect(within(card(3)).getByText("Selected")).toBeInTheDocument()
    expect(live()).toHaveTextContent("montecarlo.ai selected, source 3 of 5")
    fireEvent.click(first)
    expect(first).toHaveAttribute("aria-pressed", "false")
    expect(within(card(3)).queryByText("Selected")).toBeNull()
  })

  it("selects with Enter and Space, which buttons turn into clicks", () => {
    render(<ExampleReport />)
    const [, ibm] = citations()
    ibm.focus()
    // Native buttons fire click on Enter/Space; testing-library needs the click itself.
    fireEvent.keyDown(ibm, { key: "Enter" })
    fireEvent.click(ibm)
    expect(ibm).toHaveAttribute("aria-pressed", "true")
    expect(document.activeElement).toBe(ibm)
  })

  it("previews on hover without selecting", () => {
    render(<ExampleReport />)
    const [first] = citations()
    fireEvent.mouseEnter(first)
    expect(first).toHaveAttribute("aria-pressed", "false")
    expect(within(card(3)).queryByText("Selected")).toBeNull()
    expect(first.querySelector("[data-citation-check]")).toBeNull()
  })

  it("keeps one selection across all eight citations in the full report", () => {
    render(<ExampleReport />)
    fireEvent.click(screen.getByRole("button", { name: "Read the full report" }))
    const all = citations()
    expect(all).toHaveLength(8)
    all.forEach((c) => {
      fireEvent.click(c)
      expect(c).toHaveAttribute("aria-pressed", "true")
      expect(citations().filter((x) => x.getAttribute("aria-pressed") === "true").every((x) => x.dataset.sourceRank === c.dataset.sourceRank)).toBe(true)
      expect(document.querySelectorAll("li[id^='source-'] ")).toHaveLength(5)
      const selected = [1, 2, 3, 4, 5].filter((r) => within(card(r)).queryByText("Selected"))
      expect(selected).toEqual([Number(c.dataset.sourceRank)])
    })
  })

  it("toggles the full report and the technical details with aria-expanded", () => {
    render(<ExampleReport />)
    const report = screen.getByRole("button", { name: "Read the full report" })
    expect(report).toHaveAttribute("aria-expanded", "false")
    expect(document.getElementById(report.getAttribute("aria-controls")!)).not.toBeNull()
    fireEvent.click(report)
    expect(report).toHaveAttribute("aria-expanded", "true")
    expect(report).toHaveTextContent("Show less")
    expect(screen.getByText("Combining Approaches for Optimal Results")).toBeInTheDocument()
    act(() => fireEvent.click(report))
    expect(report).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("The Case for Fine-Tuning")).toBeInTheDocument()

    const tech = screen.getByRole("button", { name: /Technical run details/ })
    expect(tech).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(tech)
    expect(tech).toHaveAttribute("aria-expanded", "true")
    expect(document.getElementById(tech.getAttribute("aria-controls")!)).toHaveTextContent("16.5 seconds")
    expect(screen.getByText("20.16 seconds")).toBeInTheDocument()
  })

  it("links every source card to its page in a new tab", () => {
    render(<ExampleReport />)
    const links = screen.getAllByRole("link", { name: /^Open .* \(opens in a new tab\)$/ })
    expect(links).toHaveLength(5)
    links.forEach((a) => expect(a).toHaveAttribute("target", "_blank"))
  })
})

describe("source link names (WCAG 2.5.3: the visible text is part of the name)", () => {
  afterEach(cleanup)

  it("Open page links start with their visible text and keep their destinations", () => {
    render(<ExampleReport />)
    const links = screen.getAllByRole("link", { name: /^Open page for / })
    expect(links).toHaveLength(5)
    expect(links[0]).toHaveAccessibleName("Open page for arxiv.org/html/2505.15179v1 (opens in a new tab)")
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://arxiv.org/html/2505.15179v1",
      "https://orkes.io/blog/rag-best-practices",
      "https://montecarlo.ai/blog-rag-vs-fine-tuning",
      "https://www.ibm.com/think/topics/rag-vs-fine-tuning",
      "https://www.matillion.com/blog/rag-vs-fine-tuning-enterprise-ai-strategy-guide",
    ])
    links.forEach((a) => expect(a).not.toHaveAttribute("aria-label"))
  })
})
