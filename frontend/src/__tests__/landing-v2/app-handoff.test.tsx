// The landing → /app handoff touches production code. These pin two things: nothing changes
// for visitors without a kept question, and a kept question is only ever pre-filled, never sent.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const signOut = vi.fn(async () => ({}))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t", user: { id: "user-1" } } } }),
      signOut,
      updateUser: vi.fn(async () => ({ error: null })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resend: vi.fn(),
    },
  }),
}))
vi.mock("swr", () => ({ mutate: vi.fn(async () => {}) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/api", () => ({ refreshHistory: vi.fn(), confirmSessionSaved: vi.fn() }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

const authPost = vi.fn()
const authGet = vi.fn((url: string) =>
  url.includes("/api/history/")
    ? Promise.resolve({ messages: [{ id: "m1", role: "user", content: "older question", created_at: "" }] })
    : Promise.resolve({ ratings: {} })
)
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authPost: (...args: unknown[]) => authPost(...args),
  authGet: (url: string) => authGet(url),
  withAuthRedirect: (fn: () => Promise<unknown>) => fn(),
}))
const streamResearch = vi.fn()
vi.mock("@/lib/research-stream", () => ({ streamResearch: (...args: unknown[]) => streamResearch(...args) }))

let openSession: ((query: string, sessionId?: string) => void) | null = null
vi.mock("@/components/layout/sidebar", () => ({
  default: ({ onSelectQuery }: { onSelectQuery: (q: string, id?: string) => void }) => {
    openSession = onSelectQuery
    return null
  },
}))
vi.mock("@/components/research/voice-mode", () => ({ VoiceMode: () => null }))
vi.mock("@/components/research/audio-player", () => ({ AudioPlayer: () => null }))

const { savePendingQuestion, readPendingQuestion, PENDING_KEY } = await import("@/lib/pending-question")
const { StickySearchBar } = await import("@/components/research/sticky-search-bar")
const { SignInForm } = await import("@/components/auth/sign-in-form")
const { SignUpForm } = await import("@/components/auth/sign-up-form")
const { signOutAndReset } = await import("@/lib/sign-out")
const { default: AppPage } = await import("@/app/app/page")

const input = () => screen.getByLabelText("Enter your research question") as HTMLInputElement
const baseProps = { onResultsUpdate: vi.fn(), isLoading: false, setIsLoading: vi.fn(), hasResults: false }

beforeEach(() => {
  localStorage.clear()
  openSession = null
  // jsdom has no layout; the page scrolls to new messages when a conversation loads.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("auth forms", () => {
  it("render exactly as before when no question is kept", () => {
    const { container } = render(<SignInForm />)
    expect(screen.queryByText("Your question")).toBeNull()
    expect(container.querySelector("form")?.firstElementChild?.tagName).toBe("DIV")
    cleanup()
    render(<SignUpForm />)
    expect(screen.queryByText("Your question")).toBeNull()
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument()
  })

  it("show the kept question, and Remove forgets it on a shared device", async () => {
    savePendingQuestion("Which vector DB for 10k docs?")
    sessionStorage.setItem("vettan:draftQuestion", "Which vector DB for 10k docs?")
    render(<SignUpForm />)
    expect(await screen.findByText("Which vector DB for 10k docs?")).toBeInTheDocument()
    expect(screen.getByText("Kept on this device while you sign up.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(screen.queryByText("Which vector DB for 10k docs?")).toBeNull()
    expect(readPendingQuestion()).toBeNull()
    expect(sessionStorage.getItem("vettan:draftQuestion")).toBeNull()
  })

  it("signing out forgets the kept question and the unsent draft", async () => {
    savePendingQuestion("private question")
    sessionStorage.setItem("vettan:draftQuestion", "half-typed")
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    await signOutAndReset()
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(sessionStorage.getItem("vettan:draftQuestion")).toBeNull()
    expect(assign).toHaveBeenCalledWith("/sign-in")
  })
})

describe("StickySearchBar restore", () => {
  it("without the new fields behaves as before", () => {
    const onApplied = vi.fn()
    const { rerender } = render(<StickySearchBar {...baseProps} restoredQuery={null} onRestoredQueryApplied={onApplied} />)
    act(() => rerender(<StickySearchBar {...baseProps} restoredQuery={{ text: "refused", id: 1 }} />))
    expect(input().value).toBe("refused")
    expect(onApplied).not.toHaveBeenCalled()
  })

  it("reports applied only once the input shows the text", () => {
    const onApplied = vi.fn()
    render(
      <StickySearchBar
        {...baseProps}
        restoredQuery={{ text: "kept", id: 2, pendingId: "p1", ifEmpty: true }}
        onRestoredQueryApplied={onApplied}
      />
    )
    expect(input().value).toBe("kept")
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(onApplied).toHaveBeenCalledWith("p1", "applied")
  })

  it("never overwrites a draft when asked to restore only into an empty field", () => {
    const onApplied = vi.fn()
    const { rerender } = render(<StickySearchBar {...baseProps} onRestoredQueryApplied={onApplied} />)
    fireEvent.change(input(), { target: { value: "my draft" } })
    act(() =>
      rerender(
        <StickySearchBar
          {...baseProps}
          restoredQuery={{ text: "kept", id: 3, pendingId: "p2", ifEmpty: true }}
          onRestoredQueryApplied={onApplied}
        />
      )
    )
    expect(input().value).toBe("my draft")
    expect(onApplied).toHaveBeenCalledWith("p2", "declined")
    expect(onApplied).not.toHaveBeenCalledWith("p2", "applied")
  })
})

describe("/app with a kept question", () => {
  it("shows no notice and an empty bar when nothing is kept", async () => {
    render(<AppPage />)
    await act(async () => {})
    expect(input().value).toBe("")
    expect(screen.queryByText(/kept your question/)).toBeNull()
  })

  it("pre-fills an empty new research view and keeps the saved copy; nothing is sent", async () => {
    savePendingQuestion("RAG vs fine-tuning: Which should a small team choose?")
    render(<AppPage />)
    await waitFor(() => expect(input().value).toBe("RAG vs fine-tuning: Which should a small team choose?"))
    expect(await screen.findByText(/We kept your question from the homepage/)).toBeInTheDocument()
    // Leaving now (closing the tab, another conversation) mustn't lose it.
    expect(readPendingQuestion()?.text).toBe("RAG vs fine-tuning: Which should a small team choose?")
    await act(async () => {})
    expect(streamResearch).not.toHaveBeenCalled()
    expect(authPost).not.toHaveBeenCalled()
  })

  it("forgets the saved copy only once the visitor's run of it has an answer", async () => {
    savePendingQuestion("kept question")
    streamResearch.mockImplementation(async function* () {
      yield { type: "done", session_id: "s-new", citations: [], metadata: {} }
    })
    render(<AppPage />)
    await waitFor(() => expect(input().value).toBe("kept question"))
    expect(streamResearch).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByLabelText("Submit research query")))
    await waitFor(() => expect(streamResearch).toHaveBeenCalledTimes(1))
    expect(streamResearch.mock.calls[0][0]).toMatchObject({ query: "kept question" })
    await waitFor(() => expect(readPendingQuestion()).toBeNull())
  })

  it("keeps the saved copy when the visitor runs a different question instead", async () => {
    savePendingQuestion("kept question")
    streamResearch.mockImplementation(async function* () {
      yield { type: "done", session_id: "s-new", citations: [], metadata: {} }
    })
    render(<AppPage />)
    await waitFor(() => expect(input().value).toBe("kept question"))
    fireEvent.change(input(), { target: { value: "a different question" } })
    await act(async () => fireEvent.click(screen.getByLabelText("Submit research query")))
    await waitFor(() => expect(streamResearch).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(readPendingQuestion()?.text).toBe("kept question")
  })

  it("keeps the saved copy when the run fails, and puts the question back", async () => {
    savePendingQuestion("kept question")
    const { RateLimitedError } = await import("@/lib/auth-fetch")
    streamResearch.mockImplementation(async function* () {
      throw new RateLimitedError("Slow down")
    })
    render(<AppPage />)
    await waitFor(() => expect(input().value).toBe("kept question"))
    await act(async () => fireEvent.click(screen.getByLabelText("Submit research query")))
    await waitFor(() => expect(input().value).toBe("kept question"))
    expect(readPendingQuestion()?.text).toBe("kept question")
  })

  it("New chat after opening a past conversation offers the kept question again", async () => {
    savePendingQuestion("kept question")
    render(<AppPage />)
    await waitFor(() => expect(input().value).toBe("kept question"))
    await act(async () => openSession?.("older question", "session-1"))
    await waitFor(() => expect(screen.getAllByText("older question").length).toBeGreaterThan(0))
    expect(readPendingQuestion()?.text).toBe("kept question")
    await act(async () => openSession?.(""))
    await waitFor(() => expect(input().value).toBe("kept question"))
    expect(screen.getByText(/We kept your question from the homepage/)).toBeInTheDocument()
    expect(streamResearch).not.toHaveBeenCalled()
  })

  it("Forget it removes the saved copy", async () => {
    savePendingQuestion("kept question")
    render(<AppPage />)
    await screen.findByText(/We kept your question from the homepage/)
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }))
    expect(readPendingQuestion()).toBeNull()
    expect(screen.queryByText(/We kept your question/)).toBeNull()
  })

  it("opening a saved conversation afterwards loads it untouched and sends nothing", async () => {
    savePendingQuestion("kept question")
    render(<AppPage />)
    await waitFor(() => expect(input().value).toBe("kept question"))
    await act(async () => openSession?.("older question", "session-1"))
    await waitFor(() => expect(screen.getAllByText("older question").length).toBeGreaterThan(0))
    expect(screen.queryByText(/We kept your question/)).toBeNull()
    expect(authGet).toHaveBeenCalledWith(expect.stringContaining("/api/history/session-1"))
    expect(streamResearch).not.toHaveBeenCalled()
    expect(authPost).not.toHaveBeenCalled()
  })
})

describe("password reset", () => {
  it("the reset form's sign-out forgets the kept question and the draft", async () => {
    savePendingQuestion("private question")
    sessionStorage.setItem("vettan:draftQuestion", "half-typed")
    const { ResetPasswordForm } = await import("@/components/auth/reset-password-form")
    render(<ResetPasswordForm />)
    const password = await screen.findByLabelText("New password")
    fireEvent.change(password, { target: { value: "a-much-longer-password-1" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a-much-longer-password-1" } })
    await act(async () => fireEvent.submit(password.closest("form")!))
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: "global" }))
    expect(readPendingQuestion()).toBeNull()
    expect(sessionStorage.getItem("vettan:draftQuestion")).toBeNull()
  })
})

describe("auth pages on a shared browser", () => {
  it("don't show a question that belongs to an account whose session ended", async () => {
    savePendingQuestion("A's private question", Date.now(), "user-a")
    render(<SignInForm />)
    await act(async () => {})
    expect(screen.queryByText("A's private question")).toBeNull()
    expect(screen.queryByText("Your question")).toBeNull()
    cleanup()
    render(<SignUpForm />)
    await act(async () => {})
    expect(screen.queryByText("A's private question")).toBeNull()
    // Kept for its owner.
    expect(readPendingQuestion()?.text).toBe("A's private question")
  })
})
