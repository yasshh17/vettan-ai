import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Listener = (event: string, session: unknown) => void
let sessionLookup: () => Promise<{ data: { session: unknown } }>
let authListener: Listener | null = null
const unsubscribe = vi.fn()
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => sessionLookup(),
      onAuthStateChange: (cb: Listener) => {
        authListener = cb
        return { data: { subscription: { unsubscribe } } }
      },
    },
  }),
}))
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
const authPost = vi.fn()
vi.mock("@/lib/auth-fetch", () => ({ authPost }))
const streamResearch = vi.fn()
vi.mock("@/lib/research-stream", () => ({ streamResearch }))

const { ResearchField, DRAFT_KEY } = await import("@/components/landing-v2/hero/research-field")
const { PENDING_KEY, readPendingQuestion, savePendingQuestion } = await import("@/lib/pending-question")

const field = () => screen.getByLabelText("Research question") as HTMLInputElement
const start = () => screen.getByRole("button", { name: "Start research" })
const signedIn = () => Promise.resolve({ data: { session: { access_token: "t", user: { id: "user-a" } } } })
const signedInAs = (id: string) => () => Promise.resolve({ data: { session: { access_token: "t", user: { id } } } })
const signedOut = () => Promise.resolve({ data: { session: null } })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  sessionLookup = signedOut
  authListener = null
  vi.stubGlobal("fetch", vi.fn())
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function renderField() {
  render(<ResearchField />)
  await act(async () => {})
}

describe("research field", () => {
  it("keeps Start research disabled until there's a question", async () => {
    await renderField()
    expect(start()).toBeDisabled()
    fireEvent.change(field(), { target: { value: "  " } })
    expect(start()).toBeDisabled()
    fireEvent.change(field(), { target: { value: "What is RAG?" } })
    expect(start()).toBeEnabled()
  })

  it("signed out: saves the question and shows the sign-in step, nothing runs", async () => {
    await renderField()
    expect(screen.getByText("You'll sign in or create an account first. Your question is kept.")).toBeInTheDocument()
    fireEvent.change(field(), { target: { value: "What is RAG?" } })
    await act(async () => fireEvent.click(start()))
    expect(readPendingQuestion()?.text).toBe("What is RAG?")
    expect(screen.getByText("Next: sign in or create an account")).toBeInTheDocument()
    expect(screen.getByText(/Research starts when you press Start research\./)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/sign-up")
    expect(push).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(authPost).not.toHaveBeenCalled()
    expect(streamResearch).not.toHaveBeenCalled()
  })

  it("signed in: saves the question and opens /app without starting research", async () => {
    sessionLookup = signedIn
    await renderField()
    expect(screen.getByText("Your question will open in Vettan.")).toBeInTheDocument()
    fireEvent.change(field(), { target: { value: "What is RAG?" } })
    await act(async () => fireEvent.click(start()))
    expect(readPendingQuestion()?.text).toBe("What is RAG?")
    expect(push).toHaveBeenCalledWith("/app")
    expect(screen.getByText("Opening Vettan with your question…")).toBeInTheDocument()
    expect(authPost).not.toHaveBeenCalled()
    expect(streamResearch).not.toHaveBeenCalled()
  })

  it("waits for the session lookup before choosing a path", async () => {
    let finish: (v: { data: { session: unknown } }) => void = () => {}
    sessionLookup = () => new Promise((resolve) => (finish = resolve))
    render(<ResearchField />)
    fireEvent.change(field(), { target: { value: "What is RAG?" } })
    await act(async () => fireEvent.click(start()))
    expect(start()).toHaveAttribute("aria-busy", "true")
    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByText("Next: sign in or create an account")).toBeNull()
    // A second press while waiting does nothing.
    await act(async () => fireEvent.click(start()))
    await act(async () => finish({ data: { session: { access_token: "t" } } }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith("/app")
  })

  it("follows sign-in and sign-out from another tab", async () => {
    await renderField()
    // The client loads on demand, so its listener attaches a moment after mount.
    await vi.waitFor(() => expect(authListener).not.toBeNull())
    act(() => authListener?.("SIGNED_IN", { access_token: "t" }))
    expect(screen.getByText("Your question will open in Vettan.")).toBeInTheDocument()
    act(() => authListener?.("SIGNED_OUT", null))
    expect(screen.getByText("You'll sign in or create an account first. Your question is kept.")).toBeInTheDocument()
    cleanup()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it("offers to copy the question when the browser can't keep it", async () => {
    await renderField()
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    fireEvent.change(field(), { target: { value: "What is RAG?" } })
    await act(async () => fireEvent.click(start()))
    expect(screen.getByText("This browser couldn't keep your question")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy question" })).toBeInTheDocument()
    expect(screen.queryByText("Next: sign in or create an account")).toBeNull()
  })

  it("prefers an unsubmitted draft over a kept question", async () => {
    savePendingQuestion("kept question")
    sessionStorage.setItem(DRAFT_KEY, "half-typed draft")
    await renderField()
    expect(field().value).toBe("half-typed draft")
  })

  it("restores a kept question after a cancelled sign-in", async () => {
    savePendingQuestion("kept question")
    await renderField()
    expect(field().value).toBe("kept question")
    expect(screen.getByText(/You haven't signed in yet\. Your question is still here/)).toBeInTheDocument()
  })

  it("stops saying the question is kept once another tab has used it", async () => {
    await renderField()
    fireEvent.change(field(), { target: { value: "What is RAG?" } })
    await act(async () => fireEvent.click(start()))
    expect(screen.getByText("Next: sign in or create an account")).toBeInTheDocument()
    localStorage.removeItem(PENDING_KEY)
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: PENDING_KEY })))
    expect(screen.queryByText("Next: sign in or create an account")).toBeNull()
  })

  it("saves a signed-in visitor's question as theirs", async () => {
    sessionLookup = signedIn
    await renderField()
    fireEvent.change(field(), { target: { value: "owned question" } })
    await act(async () => fireEvent.click(start()))
    expect(readPendingQuestion()).toMatchObject({ text: "owned question", owner: "user-a" })
  })

  it("never shows another account's question or draft", async () => {
    savePendingQuestion("A's question", Date.now(), "user-a")
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text: "A's draft", owner: "user-a" }))
    // Signed out, then signed in as someone else: neither sees it.
    await renderField()
    expect(field().value).toBe("")
    cleanup()
    sessionLookup = signedInAs("user-b")
    await renderField()
    expect(field().value).toBe("")
    expect(screen.queryByText(/still here/)).toBeNull()
    // Not deleted: its owner still gets it back.
    expect(readPendingQuestion()?.text).toBe("A's question")
    cleanup()
    sessionLookup = signedInAs("user-a")
    await renderField()
    await vi.waitFor(() => expect(field().value).toBe("A's draft"))
  })

  it("clears a restored question when another account signs in while the page is open", async () => {
    sessionLookup = signedIn
    savePendingQuestion("A's question", Date.now(), "user-a")
    await renderField()
    await vi.waitFor(() => expect(field().value).toBe("A's question"))
    await vi.waitFor(() => expect(authListener).not.toBeNull())
    act(() => authListener?.("SIGNED_IN", { access_token: "t", user: { id: "user-b" } }))
    await vi.waitFor(() => expect(field().value).toBe(""))
    expect(readPendingQuestion()?.text).toBe("A's question")
  })

  it("binds this tab's draft when another tab claims the same question", async () => {
    await renderField()
    fireEvent.change(field(), { target: { value: "typed signed out" } })
    localStorage.setItem(PENDING_KEY, JSON.stringify({ v: 1, id: "x", text: "typed signed out", savedAt: Date.now(), owner: "user-a" }))
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: PENDING_KEY })))
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!)).toEqual({ text: "typed signed out", owner: "user-a" })
  })
})
