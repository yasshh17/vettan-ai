// A refused first query must come back in whichever search bar is mounted, without a
// paid retry on /api/research. In production the hero bar had already been replaced by
// the docked bar when the refusal arrived, so the text was lost.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  }),
}))
vi.mock("@/lib/api", () => ({ refreshHistory: vi.fn(), confirmSessionSaved: vi.fn() }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

const authPost = vi.fn()
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authPost: (...args: unknown[]) => authPost(...args),
}))

const { ContentBlockedError } = await import("@/lib/auth-fetch")
const streamResearch = vi.fn()
vi.mock("@/lib/research-stream", () => ({
  streamResearch: (...args: unknown[]) => streamResearch(...args),
}))

const { StickySearchBar } = await import("@/components/research/sticky-search-bar")

const baseProps = {
  onResultsUpdate: vi.fn(),
  isLoading: false,
  setIsLoading: vi.fn(),
  hasResults: false,
}

describe("refused queries", () => {
  afterEach(cleanup)

  it("hands a refused first query to the page and does not retry it", async () => {
    streamResearch.mockImplementation(async function* () {
      throw new ContentBlockedError("This request can't be processed.", "input")
    })
    const onRestoreQuery = vi.fn()
    const onStreamEvent = vi.fn()
    render(
      <StickySearchBar {...baseProps} onStreamEvent={onStreamEvent} onRestoreQuery={onRestoreQuery} />
    )

    fireEvent.change(screen.getByLabelText("Enter your research question"), {
      target: { value: "a refused question" },
    })
    fireEvent.click(screen.getByLabelText("Submit research query"))

    await waitFor(() => expect(onRestoreQuery).toHaveBeenCalledWith("a refused question"))
    expect(onStreamEvent).toHaveBeenCalledWith(
      { type: "blocked", message: "This request can't be processed." },
      { query: "a refused question", isFollowUp: false }
    )
    expect(authPost).not.toHaveBeenCalled()
  })

  it("does not hand a self-harm message back to resend", async () => {
    streamResearch.mockImplementation(async function* () {
      throw new ContentBlockedError("You don't have to face it alone: findahelpline.com.", "input")
    })
    const onRestoreQuery = vi.fn()
    const onStreamEvent = vi.fn()
    render(
      <StickySearchBar {...baseProps} onStreamEvent={onStreamEvent} onRestoreQuery={onRestoreQuery} />
    )

    fireEvent.change(screen.getByLabelText("Enter your research question"), {
      target: { value: "I want to kill myself" },
    })
    fireEvent.click(screen.getByLabelText("Submit research query"))

    await waitFor(() =>
      expect(onStreamEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "blocked" }),
        expect.anything()
      )
    )
    expect(onRestoreQuery).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Enter your research question") as HTMLInputElement).value).toBe("")
  })

  it("fills an already-mounted bar when the page re-delivers the query", () => {
    const { rerender } = render(<StickySearchBar {...baseProps} hasResults restoredQuery={null} />)
    const input = screen.getByLabelText("Enter your research question") as HTMLInputElement
    expect(input.value).toBe("")

    act(() => {
      rerender(
        <StickySearchBar {...baseProps} hasResults restoredQuery={{ text: "try again", id: 1 }} />
      )
    })
    expect(input.value).toBe("try again")
  })
})
