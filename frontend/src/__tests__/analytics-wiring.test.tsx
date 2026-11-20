// Where the app records usage events, and the `source` sent with each question.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = { path: "/app" }
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const signInWithPassword = vi.fn()
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
    },
  }),
}))
vi.mock("@/lib/api", () => ({ refreshHistory: vi.fn(), confirmSessionSaved: vi.fn(async () => true) }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

const token: { value: string | null } = { value: "t" }
const authGet = vi.fn()
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authGet: (...a: unknown[]) => authGet(...a),
  getAccessToken: async () => token.value,
}))

const track = vi.fn()
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  track: (...a: unknown[]) => track(...a),
}))

const streamResearch = vi.fn()
vi.mock("@/lib/research-stream", () => ({
  streamResearch: (...a: unknown[]) => streamResearch(...a),
}))

const { CollapsibleSources } = await import("@/components/research/collapsible-sources")
const { UsageTracker } = await import("@/components/analytics/usage-tracker")
const { SignInForm } = await import("@/components/auth/sign-in-form")
const { StickySearchBar } = await import("@/components/research/sticky-search-bar")
const { SUGGESTED_QUESTIONS } = await import("@/lib/suggested-questions")

const granted = { decided: true, granted: true, erasure_pending: false, erasure_completed: false }
const declined = { ...granted, granted: false }

beforeEach(() => {
  nav.path = "/app"
  token.value = "t"
  authGet.mockResolvedValue(granted)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("sources", () => {
  const sources = [
    { domain: "a.example", url: "https://a.example/x" },
    { domain: "b.example", url: "https://b.example/y" },
  ]

  it("records opening the list with the count, not closing it", () => {
    render(<CollapsibleSources sources={sources} />)
    fireEvent.click(screen.getByLabelText("Expand sources"))
    fireEvent.click(screen.getByLabelText("Collapse sources"))
    expect(track.mock.calls).toEqual([["sources_expanded", { count: 2 }]])
  })

  it("records a citation click without the link", () => {
    render(<CollapsibleSources sources={sources} />)
    fireEvent.click(screen.getByLabelText("Expand sources"))
    fireEvent.click(screen.getByLabelText("Open source 1: a.example"))
    expect(track).toHaveBeenLastCalledWith("citation_clicked")
  })
})

describe("page views", () => {
  // The consent state lives in a module, so each test starts from a fresh copy.
  async function freshTracker() {
    vi.resetModules()
    return (await import("@/components/analytics/usage-tracker")).UsageTracker
  }

  it("asks nothing and records nothing for a signed-out visitor", async () => {
    token.value = null
    const Tracker = await freshTracker()
    render(<Tracker />)
    await new Promise((r) => setTimeout(r, 20))
    expect(authGet).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it("records each page once consent is known to be granted", async () => {
    const Tracker = await freshTracker()
    const { rerender } = render(<Tracker />)
    await waitFor(() => expect(track).toHaveBeenCalledWith("page_viewed", { route: "app" }))
    nav.path = "/privacy"
    rerender(<Tracker />)
    await waitFor(() => expect(track).toHaveBeenCalledWith("page_viewed", { route: "privacy" }))
    expect(track).toHaveBeenCalledTimes(2)
  })

  it("records nothing when consent is off", async () => {
    authGet.mockResolvedValue(declined)
    const Tracker = await freshTracker()
    render(<Tracker />)
    await waitFor(() => expect(authGet).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(track).not.toHaveBeenCalled()
  })

  it("is the same component the layout renders", () => {
    expect(UsageTracker).toBeTypeOf("function")
  })
})

describe("sign-in", () => {
  it("records signed_in once consent has been read", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null })
    render(<SignInForm />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw-long-enough" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() => expect(track).toHaveBeenCalledWith("signed_in"))
    expect(authGet).toHaveBeenCalled()
  })

  it("records nothing when sign-in fails", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: "invalid_credentials" } })
    render(<SignInForm />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    await screen.findByText("Invalid email or password.")
    expect(track).not.toHaveBeenCalled()
  })
})

describe("question source", () => {
  let recognition: { onresult?: (e: unknown) => void; start: () => void; stop: () => void } | null = null

  beforeEach(() => {
    recognition = null
    vi.stubGlobal(
      "webkitSpeechRecognition",
      class {
        start = vi.fn()
        stop = vi.fn()
        onresult?: (e: unknown) => void
        constructor() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          recognition = this
        }
      }
    )
    streamResearch.mockImplementation(async function* () {})
  })

  afterEach(() => vi.unstubAllGlobals())

  function renderBar() {
    render(
      <StickySearchBar onResultsUpdate={vi.fn()} isLoading={false} setIsLoading={vi.fn()} hasResults={false} />
    )
    return screen.getByLabelText("Enter your research question")
  }

  async function submittedSource() {
    fireEvent.click(screen.getByLabelText("Submit research query"))
    await waitFor(() => expect(streamResearch).toHaveBeenCalled())
    return streamResearch.mock.calls[0][0].source
  }

  it("typed by default", async () => {
    fireEvent.change(renderBar(), { target: { value: "my own question" } })
    expect(await submittedSource()).toBe("typed")
  })

  it("suggested when a suggestion is sent as is", async () => {
    fireEvent.change(renderBar(), { target: { value: SUGGESTED_QUESTIONS[1] } })
    expect(await submittedSource()).toBe("suggested")
  })

  it("typed once a suggestion is edited", async () => {
    fireEvent.change(renderBar(), { target: { value: SUGGESTED_QUESTIONS[1] + " in 2026" } })
    expect(await submittedSource()).toBe("typed")
  })

  it("voice when dictated", async () => {
    renderBar()
    fireEvent.click(screen.getByLabelText("Start dictation"))
    recognition!.onresult!({ results: [[{ transcript: "dictated question" }]] })
    await waitFor(() =>
      expect((screen.getByLabelText("Enter your research question") as HTMLInputElement).value).toBe(
        "dictated question"
      )
    )
    expect(await submittedSource()).toBe("voice")
  })
})
