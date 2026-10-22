// A stream that fails or is stopped after some text has already arrived must leave that text
// visibly marked incomplete, with no audio/feedback UI implying it finished normally.
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
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authPost: vi.fn(),
  authGet: vi.fn(async () => ({ ratings: {} })),
  withAuthRedirect: (fn: () => Promise<unknown>) => fn(),
}))
const streamResearch = vi.fn()
vi.mock("@/lib/research-stream", () => ({ streamResearch: (...args: unknown[]) => streamResearch(...args) }))
vi.mock("@/components/layout/sidebar", () => ({ default: () => null }))
vi.mock("@/components/research/voice-mode", () => ({ VoiceMode: () => null }))
// A visible sentinel, not null: asserting its absence only means something if it could render.
vi.mock("@/components/research/audio-player", () => ({
  AudioPlayer: () => <div data-testid="audio-player">audio</div>,
}))

const { default: AppPage } = await import("@/app/app/page")

let network: string[] = []

beforeEach(() => {
  network = blockNetwork()
  localStorage.clear()
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

async function submit(question: string) {
  fireEvent.change(screen.getByLabelText("Enter your research question"), { target: { value: question } })
  await act(async () => fireEvent.click(screen.getByLabelText("Submit research query")))
}

describe("a partial answer is marked incomplete", () => {
  it("mid-stream error: partial text stays, marked incomplete, no feedback/audio", async () => {
    streamResearch.mockImplementation(async function* () {
      yield { type: "token", text: "The report says " }
      yield { type: "error", message: "Failed to process research request" }
    })
    render(<AppPage />)
    await submit("what happened")

    await waitFor(() => expect(screen.getByText(/The report says/)).toBeInTheDocument())
    expect(screen.getByText(/This answer is incomplete: Failed to process research request/)).toBeInTheDocument()
    // A failed stream never reaches "done", so it never gets a saved session/message id either;
    // AnswerFeedback already refuses to render without one. The meaningful check here is audio.
    expect(screen.queryByTestId("audio-player")).toBeNull()
  })

  it("stopped mid-stream: partial text stays, marked incomplete, no feedback/audio", async () => {
    let controllerSignal: AbortSignal | undefined
    streamResearch.mockImplementation(async function* (_payload: unknown, signal?: AbortSignal) {
      controllerSignal = signal
      yield { type: "token", text: "Partial findings " }
      await new Promise((resolve) => {
        signal?.addEventListener("abort", () => resolve(undefined))
      })
      throw new DOMException("aborted", "AbortError")
    })
    render(<AppPage />)
    await submit("what happened")

    await waitFor(() => expect(screen.getByText(/Partial findings/)).toBeInTheDocument())
    await waitFor(() => expect(controllerSignal).toBeInstanceOf(AbortSignal))
    await act(async () => fireEvent.click(screen.getByLabelText("Stop generating")))

    await waitFor(() => expect(screen.getByText(/Stopped\. This partial answer was not saved\./)).toBeInTheDocument())
    expect(screen.getByText(/This answer is incomplete\./)).toBeInTheDocument()
    // Same reasoning as above: an aborted message never reaches "done" either.
    expect(screen.queryByTestId("audio-player")).toBeNull()
  })

  it("a normal completion is never marked incomplete and still shows feedback/audio", async () => {
    const SESSION_ID = "11111111-1111-1111-1111-111111111111"
    const MESSAGE_ID = "22222222-2222-2222-2222-222222222222"
    streamResearch.mockImplementation(async function* () {
      yield { type: "sources", citations: [], sources_count: 0 }
      yield { type: "token", text: "Full answer." }
      yield { type: "done", session_id: SESSION_ID, assistant_message_id: MESSAGE_ID, citations: [], metadata: {} }
    })
    render(<AppPage />)
    await submit("what happened")

    await waitFor(() => expect(screen.getByText(/Full answer\./)).toBeInTheDocument())
    expect(screen.queryByText(/This answer is incomplete/)).toBeNull()
    await waitFor(() => expect(screen.getByLabelText("Good answer")).toBeInTheDocument())
    expect(screen.getByTestId("audio-player")).toBeInTheDocument()
  })
})
