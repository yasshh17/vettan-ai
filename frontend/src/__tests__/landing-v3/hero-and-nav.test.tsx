import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEMO } from "@/lib/research-demo"
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

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderPage({ reducedMotion = false } = {}) {
  installDomMocks({ reducedMotion })
  render(<LandingV3 />)
  await act(async () => {})
}

// The page has a second question field (closing CTA) and the story repeats the step names.
const hero = () => within(document.getElementById("start")!)

describe("landing v3 hero", () => {
  it("leads with the new headline, the question field and the real report excerpt", async () => {
    await renderPage()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Research you can check.")
    expect(hero().getByLabelText("Research question")).toBeInTheDocument()
    expect(hero().getByRole("heading", { level: 2, name: DEMO.query })).toBeInTheDocument()
    expect(hero().getByRole("button", { name: "Citation: montecarlo.ai. Show this source" })).toBeInTheDocument()
  })

  it("keeps Start research disabled until there's a question", async () => {
    await renderPage()
    const start = hero().getByRole("button", { name: "Start research" })
    expect(start).toBeDisabled()
    fireEvent.change(hero().getByLabelText("Research question"), { target: { value: "Which vector database for 10k docs?" } })
    expect(start).toBeEnabled()
  })

  it("under reduced motion shows the finished run and no replay", async () => {
    await renderPage({ reducedMotion: true })
    expect(hero().getByText("06 Result")).toHaveAttribute("aria-current", "step")
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull()
  })

  it("never claims more than the pipeline does", async () => {
    await renderPage()
    expect(document.body.textContent).not.toMatch(/ReAct|multi-agent|verif/i)
    // The writer gets search-result excerpts, not whole pages.
    expect(document.body.textContent).toMatch(/reads excerpts from the most relevant pages/)
    expect(document.body.textContent).not.toMatch(/reads the most relevant pages|pages are read/i)
  })

  it("gives the stage its shape in CSS, so the server HTML doesn't jump on phones", async () => {
    await renderPage()
    const stage = document.querySelector("#start canvas")!.parentElement!
    expect(stage.className).toContain("aspect-[390/700]")
    expect(stage.className).toContain("@3xl:aspect-[1440/620]")
    expect(stage.getAttribute("style")).toBeNull()
  })
})

describe("landing v3 nav", () => {
  it("Ask a question puts the cursor in the hero's field", async () => {
    await renderPage()
    const nav = screen.getByRole("navigation", { name: "Main" })
    fireEvent.click(nav.querySelector('a[href="#start"]:not([class*="text-[20px]"])')!)
    expect(document.activeElement).toBe(hero().getByLabelText("Research question"))
  })

  it("opens the phone menu as a dialog that closes on Escape and returns focus", async () => {
    await renderPage()
    const trigger = screen.getByRole("button", { name: "Menu" })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("How it works")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // Radix hands focus back on the next tick, once the dialog has unmounted.
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
