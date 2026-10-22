// beforeOpen marks the only stream failures that are safe to retry on /api/research:
// the server never started the run, so nothing was charged.
import { describe, expect, it, vi } from "vitest"

const authFetch = vi.fn()
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authFetch: (...args: unknown[]) => authFetch(...args),
}))

const { RateLimitedError } = await import("@/lib/auth-fetch")
const { streamResearch } = await import("@/lib/research-stream")

async function failure(signal?: AbortSignal) {
  try {
    for await (const _ of streamResearch({ query: "q" }, signal)) {
      // drain
    }
  } catch (err) {
    return err as Error & { status?: number; beforeOpen?: boolean }
  }
  throw new Error("expected the stream to fail")
}

function bodyThatBreaks(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"hi"}\n\n'))
      controller.error(new TypeError("network error"))
    },
  })
}

describe("streamResearch failures", () => {
  it("marks a connection that never opened", async () => {
    authFetch.mockRejectedValue(new TypeError("Failed to fetch"))
    expect((await failure()).beforeOpen).toBe(true)
  })

  it("marks a non-OK response, keeping its status", async () => {
    authFetch.mockResolvedValue(new Response("not found", { status: 404 }))
    const err = await failure()
    expect(err.beforeOpen).toBe(true)
    expect(err.status).toBe(404)
  })

  it("leaves refusals unmarked", async () => {
    authFetch.mockRejectedValue(new RateLimitedError("Slow down", 30))
    const err = await failure()
    expect(err).toBeInstanceOf(RateLimitedError)
    expect(err.beforeOpen).toBeUndefined()
  })

  it("leaves a failure after the stream opened unmarked", async () => {
    authFetch.mockResolvedValue(new Response(bodyThatBreaks(), { status: 200 }))
    expect((await failure()).beforeOpen).toBeUndefined()
  })

  it("leaves an aborted request unmarked", async () => {
    const controller = new AbortController()
    controller.abort()
    authFetch.mockRejectedValue(new TypeError("aborted"))
    expect((await failure(controller.signal)).beforeOpen).toBeUndefined()
  })
})
