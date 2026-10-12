import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  }),
}))

const authPut = vi.fn()
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authPut: (...args: unknown[]) => authPut(...args),
}))

const { AnswerFeedback } = await import("@/components/research/answer-feedback")

const SESSION = "33333333-3333-3333-3333-333333333333"
const ANSWER = "55555555-5555-5555-5555-555555555555"

const up = () => screen.getByRole("button", { name: "Good answer" })
const down = () => screen.getByRole("button", { name: "Bad answer" })

afterEach(() => {
  cleanup()
  authPut.mockReset()
})

describe("AnswerFeedback", () => {
  it("sends the vote for this answer", async () => {
    authPut.mockResolvedValue({ success: true })
    render(<AnswerFeedback sessionId={SESSION} messageId={ANSWER} isFollowup />)

    fireEvent.click(up())

    await waitFor(() => expect(authPut).toHaveBeenCalledTimes(1))
    expect(authPut.mock.calls[0][0]).toMatch(/\/api\/feedback$/)
    expect(authPut.mock.calls[0][1]).toEqual({
      session_id: SESSION,
      message_id: ANSWER,
      rating: "up",
      is_followup: true,
    })
    expect(up().getAttribute("aria-pressed")).toBe("true")
  })

  it("clears the vote when the same thumb is clicked again", async () => {
    authPut.mockResolvedValue({ success: true })
    render(<AnswerFeedback sessionId={SESSION} messageId={ANSWER} initialRating="down" />)
    expect(down().getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(down())

    await waitFor(() => expect(authPut).toHaveBeenCalledTimes(1))
    expect(authPut.mock.calls[0][1]).toMatchObject({ rating: null })
    await waitFor(() => expect(down().getAttribute("aria-pressed")).toBe("false"))
  })

  it("puts the old vote back if saving fails", async () => {
    authPut.mockRejectedValue(new Error("network"))
    render(<AnswerFeedback sessionId={SESSION} messageId={ANSWER} initialRating="up" />)

    fireEvent.click(down())

    await waitFor(() => expect(authPut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(up().getAttribute("aria-pressed")).toBe("true"))
    expect(down().getAttribute("aria-pressed")).toBe("false")
  })

  it("renders nothing for placeholder ids", () => {
    const { container, rerender } = render(<AnswerFeedback sessionId={SESSION} messageId="2" />)
    expect(container.innerHTML).toBe("")
    rerender(<AnswerFeedback sessionId={null} messageId={ANSWER} />)
    expect(container.innerHTML).toBe("")
  })
})
