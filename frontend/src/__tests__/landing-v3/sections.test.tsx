import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEMO, DEMO_CITATIONS } from "@/lib/research-demo"
import { VOICES } from "@/lib/voices"
import { installDomMocks } from "../landing-v2/dom-mocks"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { LandingV3 } = await import("@/components/landing-v3/landing-v3")
const { captions } = await import("@/components/landing-v3/story/story")
const { STEP_AT } = await import("@/lib/constellation/timeline")
const { DOMAINS } = await import("@/lib/constellation/geometry")
const { HERO_CITED_RANK } = await import("@/components/landing-v3/cited")

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderPage() {
  // matchMedia answers false for widths here, so the page lays out as it does on a phone.
  installDomMocks()
  render(<LandingV3 />)
  await act(async () => {})
}

const section = (id: string) => document.getElementById(id) as HTMLElement

describe("landing v3 sections", () => {
  it("tells the story in six moments, saying the report is written from excerpts", async () => {
    await renderPage()
    const story = within(section("how"))
    expect(story.getByRole("heading", { level: 2 })).toHaveTextContent("Follow one real question to a cited report.")
    expect(story.getAllByRole("heading", { level: 3 })).toHaveLength(6)
    expect(story.getByText("The report is written from those excerpts")).toBeInTheDocument()
    for (const q of DEMO.subQueries) expect(story.getAllByText(q).length).toBeGreaterThan(0)
  })

  it("shows the whole recorded report with every citation and all five sources", async () => {
    await renderPage()
    const report = within(section("example"))
    expect(report.getAllByRole("button", { name: /^Citation: / })).toHaveLength(DEMO_CITATIONS.length)
    expect(report.getByRole("heading", { name: `Sources (${DEMO.sources.length})` })).toBeInTheDocument()
    for (const s of DEMO.sources) expect(report.getByRole("link", { name: new RegExp(`for ${s.domain.replace(/\./g, "\\.")}`) })).toBeInTheDocument()
  })

  it("on a phone, a citation opens a non-modal source sheet that hands focus back on Escape", async () => {
    await renderPage()
    const [cite] = within(section("example")).getAllByRole("button", { name: /^Citation: / })
    cite.focus()
    fireEvent.click(cite)
    const sheet = await screen.findByRole("dialog")
    const rank = Number(cite.getAttribute("data-source-rank"))
    expect(sheet).toHaveTextContent(DEMO.sources[rank - 1].domain)
    expect(within(sheet).getByRole("link", { name: /Open page/ })).toHaveAttribute("href", DEMO.sources[rank - 1].url)
    expect(document.body.textContent).toContain(`${DEMO.sources[rank - 1].domain} selected`)
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(cite))
  })

  it("draws the feature demos as pictures: no fake buttons, the real voice list", async () => {
    await renderPage()
    const features = section("features")
    expect(within(features).queryAllByRole("button")).toHaveLength(0)
    expect(within(features).queryAllByRole("radio")).toHaveLength(0)
    for (const desc of Object.values(VOICES)) expect(features.textContent).toContain(desc)
    expect(features.textContent).toContain("If the searches come back empty")
  })

  it("ends with a second question field and the legal links", async () => {
    await renderPage()
    expect(screen.getAllByLabelText("Research question")).toHaveLength(2)
    const footer = screen.getByRole("contentinfo")
    for (const href of ["/terms", "/privacy", "/usage-policy"]) expect(footer.querySelector(`a[href="${href}"]`)).not.toBeNull()
  })

  it("clears the story's labels from under the result card, except the cited source", () => {
    const shown = captions(STEP_AT[5], false).filter((c) => c.alpha > 0.01).map((c) => c.text)
    expect(shown).toEqual([DOMAINS[HERO_CITED_RANK - 1]])
    // On the phone strip the name sits left of its star, clear of the report lines.
    const [strip] = captions(STEP_AT[5], true).filter((c) => c.alpha > 0.01)
    expect(strip).toMatchObject({ text: DOMAINS[HERO_CITED_RANK - 1], align: "right" })
    expect(strip.dx).toBeLessThan(0)
  })

  it("speaks the voice demo's question word by word, so the reveal works on any line count", async () => {
    await renderPage()
    const spoken = section("features").querySelector(".lv3-type")!
    expect(spoken.children).toHaveLength(DEMO.query.split(" ").length)
    expect(spoken.textContent).toBe(DEMO.query)
  })

  it("never says Vettan reads whole pages", async () => {
    await renderPage()
    expect(document.body.textContent).not.toMatch(/reads the most relevant pages|pages are read|reads up to|written from those pages/i)
    expect(document.body.textContent).not.toMatch(/ReAct|multi-agent|verif/i)
  })
})
