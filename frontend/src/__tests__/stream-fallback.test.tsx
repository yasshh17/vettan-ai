// /api/research is a second, separately charged run. The search bar may only fall back to it
// when the stream never opened; once the server has started, a retry would pay twice.
import { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { blockNetwork } from "./block-network"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  }),
}))
vi.mock("@/lib/api", () => ({ refreshHistory: vi.fn(), confirmSessionSaved: vi.fn(async () => true) }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

const authPost = vi.fn()
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authPost: (...args: unknown[]) => authPost(...args),
}))

const streamResearch = vi.fn()
vi.mock("@/lib/research-stream", () => ({
  streamResearch: (...args: unknown[]) => streamResearch(...args),
}))

const { StickySearchBar } = await import("@/components/research/sticky-search-bar")

const QUESTION = "what changed in battery chemistry"
const CONTEXT = { query: QUESTION, isFollowUp: false }

function submit() {
  const onStreamEvent = vi.fn()
  const onRestoreQuery = vi.fn()
  const onResultsUpdate = vi.fn()
  render(
    <StickySearchBar
      onResultsUpdate={onResultsUpdate}
      isLoading={false}
      setIsLoading={vi.fn()}
      hasResults={false}
      onStreamEvent={onStreamEvent}
      onRestoreQuery={onRestoreQuery}
    />
  )
  fireEvent.change(screen.getByLabelText("Enter your research question"), { target: { value: QUESTION } })
  fireEvent.click(screen.getByLabelText("Submit research query"))
  return { onStreamEvent, onRestoreQuery, onResultsUpdate }
}

/**
 * The real parent (page.tsx) owns `isLoading` as state and passes `setIsLoading` down, so the
 * Stop button (gated on the `isLoading` *prop*) only ever appears when the harness mirrors that.
 * The static `submit()` helper above never flips it, since it hands in a no-op `setIsLoading`.
 */
function StatefulHarness({
  onStreamEvent,
  onRestoreQuery,
  onResultsUpdate
}: {
  onStreamEvent: (...args: unknown[]) => void
  onRestoreQuery: (...args: unknown[]) => void
  onResultsUpdate: (...args: unknown[]) => void
}) {
  const [isLoading, setIsLoading] = useState(false)
  return (
    <StickySearchBar
      onResultsUpdate={onResultsUpdate}
      isLoading={isLoading}
      setIsLoading={setIsLoading}
      hasResults={false}
      onStreamEvent={onStreamEvent}
      onRestoreQuery={onRestoreQuery}
    />
  )
}

function submitWithStop() {
  const onStreamEvent = vi.fn()
  const onRestoreQuery = vi.fn()
  const onResultsUpdate = vi.fn()
  render(
    <StatefulHarness onStreamEvent={onStreamEvent} onRestoreQuery={onRestoreQuery} onResultsUpdate={onResultsUpdate} />
  )
  fireEvent.change(screen.getByLabelText("Enter your research question"), { target: { value: QUESTION } })
  fireEvent.click(screen.getByLabelText("Submit research query"))
  return { onStreamEvent, onRestoreQuery, onResultsUpdate }
}

describe("stream failures", () => {
  let network: string[] = []
  beforeEach(() => {
    network = blockNetwork()
    authPost.mockReset()
    authPost.mockResolvedValue({ output: "fallback answer", session_id: "s-2", citations: [], metadata: {} })
  })
  afterEach(() => {
    expect(network).toEqual([])
    cleanup()
    vi.unstubAllGlobals()
  })

  it("does not re-run the research when the server reports an error mid-stream", async () => {
    streamResearch.mockImplementation(async function* () {
      yield { type: "stage", phase: "decomposed", sub_queries: ["a", "b"] }
      yield { type: "error", message: "Failed to process research request" }
    })
    const { onStreamEvent, onRestoreQuery } = submit()

    await waitFor(() => expect(onRestoreQuery).toHaveBeenCalledWith(QUESTION))
    expect(onStreamEvent).toHaveBeenCalledWith({ type: "error", message: "Failed to process research request" }, CONTEXT)
    expect(authPost).not.toHaveBeenCalled()
  })

  it("does not re-run the research when the stream ends without done", async () => {
    streamResearch.mockImplementation(async function* () {
      yield { type: "token", text: "partial" }
    })
    const { onStreamEvent, onRestoreQuery } = submit()

    await waitFor(() => expect(onRestoreQuery).toHaveBeenCalledWith(QUESTION))
    expect(onStreamEvent).toHaveBeenCalledWith(
      { type: "error", message: "The answer ended before it was complete." },
      CONTEXT
    )
    expect(authPost).not.toHaveBeenCalled()
  })

  it("does not re-run the research when the connection drops after the stream opened", async () => {
    streamResearch.mockImplementation(async function* () {
      yield { type: "sources", citations: [], sources_count: 0 }
      throw new TypeError("network error")
    })
    const { onRestoreQuery } = submit()

    await waitFor(() => expect(onRestoreQuery).toHaveBeenCalledWith(QUESTION))
    expect(authPost).not.toHaveBeenCalled()
  })

  it("falls back once when the stream never opened", async () => {
    streamResearch.mockImplementation(async function* () {
      throw Object.assign(new Error("Stream request failed (404)"), { status: 404, beforeOpen: true })
    })
    const { onResultsUpdate, onRestoreQuery } = submit()

    await waitFor(() => expect(onResultsUpdate).toHaveBeenCalled())
    expect(authPost).toHaveBeenCalledTimes(1)
    expect(authPost.mock.calls[0][0]).toMatch(/\/api\/research$/)
    expect(onRestoreQuery).not.toHaveBeenCalled()
  })

  it("finishes a normal stream without touching /api/research", async () => {
    streamResearch.mockImplementation(async function* () {
      yield { type: "stage", phase: "decomposed", sub_queries: ["a"] }
      yield { type: "sources", citations: [], sources_count: 0 }
      yield { type: "token", text: "answer" }
      yield { type: "done", session_id: "s-1", citations: [], metadata: {} }
    })
    const { onResultsUpdate, onStreamEvent } = submit()

    await waitFor(() =>
      expect(onResultsUpdate).toHaveBeenCalledWith(expect.objectContaining({ session_id: "s-1", streamed: true }))
    )
    expect(authPost).not.toHaveBeenCalled()
    expect(onStreamEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }), expect.anything())
  })

  it("Stop cancels the /api/research fallback: no late update, box stays clear", async () => {
    streamResearch.mockImplementation(async function* () {
      throw Object.assign(new Error("Stream request failed (404)"), { status: 404, beforeOpen: true })
    })
    let capturedSignal: AbortSignal | undefined
    authPost.mockImplementation((_url: string, _body: unknown, config?: { signal?: AbortSignal }) => {
      capturedSignal = config?.signal
      // Never resolves on its own; only abort settles it, so a late success can't sneak in.
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    })

    const { onStreamEvent, onResultsUpdate } = submitWithStop()

    await waitFor(() => expect(authPost).toHaveBeenCalledTimes(1))
    // The fallback call must carry a real, not-yet-aborted signal.
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(false)

    fireEvent.click(await screen.findByLabelText("Stop generating"))

    await waitFor(() => expect(onStreamEvent).toHaveBeenCalledWith({ type: "aborted" }, CONTEXT))
    // A late/successful response from the aborted request must never reach onResultsUpdate.
    expect(onResultsUpdate).not.toHaveBeenCalled()
    // Not treated as a retryable failure: the question isn't put back for editing.
    expect(onStreamEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }), expect.anything())
    // The box stays clear rather than being refilled with the stopped question.
    expect((screen.getByLabelText("Enter your research question") as HTMLInputElement).value).toBe("")
  })
})
