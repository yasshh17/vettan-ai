// A failed question put back in the box for retry belongs to the chat it failed in. Opening a
// different chat must not carry it over, where Enter would send it as that chat's follow-up.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { blockNetwork } from "./block-network"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}))
vi.mock("swr", () => ({ mutate: vi.fn(async () => {}) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/api", () => ({ refreshHistory: vi.fn(), confirmSessionSaved: vi.fn(async () => true) }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

const HISTORY: Record<string, { messages: unknown[] }> = {
  "session-a": {
    messages: [
      { id: "a1", role: "user", content: "question A", created_at: "" },
      { id: "a2", role: "assistant", content: "answer A", created_at: "" },
    ],
  },
  "session-b": {
    messages: [
      { id: "b1", role: "user", content: "question B", created_at: "" },
      { id: "b2", role: "assistant", content: "answer B", created_at: "" },
    ],
  },
}
const authPost = vi.fn()
const authGet = vi.fn(async (url: string) => {
  const match = url.match(/\/api\/history\/([^/?]+)$/)
  return match ? HISTORY[match[1]] : { ratings: {} }
})
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

const { default: AppPage } = await import("@/app/app/page")

const input = () => screen.getByLabelText("Enter your research question") as HTMLInputElement

// A run the server started and then failed: no fallback, the question is put back for retry.
function failMidStream() {
  streamResearch.mockImplementation(async function* () {
    yield { type: "stage", phase: "decomposed", sub_queries: ["x"] }
    yield { type: "error", message: "Failed to process research request" }
  })
}

async function open(query: string, sessionId: string, answer: string) {
  await act(async () => openSession?.(query, sessionId))
  await waitFor(() => expect(screen.getByText(answer)).toBeInTheDocument())
}

async function submit(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  await act(async () => fireEvent.click(screen.getByLabelText("Submit research query")))
}

let network: string[] = []

beforeEach(() => {
  network = blockNetwork()
  localStorage.clear()
  openSession = null
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
})
afterEach(() => {
  expect(network).toEqual([])
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("switching chats", () => {
  it("a failed follow-up in chat A is not carried into chat B", async () => {
    render(<AppPage />)
    await open("question A", "session-a", "answer A")

    failMidStream()
    await submit("failed in A")
    await waitFor(() => expect(input().value).toBe("failed in A"))

    await open("question B", "session-b", "answer B")
    expect(input().value).toBe("")
  })

  it("a failed first question is not carried into a chat opened from history", async () => {
    render(<AppPage />)
    failMidStream()
    await submit("first question fails")
    await waitFor(() => expect(input().value).toBe("first question fails"))

    await open("question B", "session-b", "answer B")
    expect(input().value).toBe("")
  })

  it("after switching, Enter alone sends nothing; a typed question goes to the chat now open", async () => {
    render(<AppPage />)
    await open("question A", "session-a", "answer A")
    failMidStream()
    await submit("failed in A")
    await waitFor(() => expect(input().value).toBe("failed in A"))

    await open("question B", "session-b", "answer B")
    streamResearch.mockClear()
    // QA's repro: pressing Enter right after opening chat B used to send chat A's failed question.
    await act(async () => fireEvent.keyDown(input(), { key: "Enter" }))
    expect(streamResearch).not.toHaveBeenCalled()

    streamResearch.mockImplementation(async function* () {
      yield { type: "token", text: "ok" }
      yield { type: "done", session_id: "session-b", citations: [], metadata: {} }
    })
    await submit("new question for B")

    await waitFor(() => expect(streamResearch).toHaveBeenCalledTimes(1))
    expect(streamResearch.mock.calls[0][0]).toMatchObject({
      query: "new question for B",
      session_id: "session-b",
      is_followup: true,
    })
    expect(authPost).not.toHaveBeenCalled()
  })

  it("reselecting the chat that's already open keeps a typed draft", async () => {
    render(<AppPage />)
    await open("question A", "session-a", "answer A")
    fireEvent.change(input(), { target: { value: "half-written draft" } })

    await open("question A", "session-a", "answer A")
    expect(input().value).toBe("half-written draft")
  })
})
