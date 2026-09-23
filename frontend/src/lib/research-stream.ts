import { authFetch } from "@/lib/auth-fetch"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export interface ResearchPayload {
  query: string
  max_iterations?: number
  use_cache?: boolean
  session_id?: string
  is_followup?: boolean
}

/**
 * Events the UI reacts to. "submitted" and "aborted" are raised on the client
 * (the server never sends them); the rest arrive as SSE frames.
 */
export type StreamEvent =
  | { type: "submitted" }
  | { type: "aborted" }
  /** The answer finished but never reached the user's history. */
  | { type: "not_saved" }
  | { type: "stage"; phase: string; sub_queries: string[] }
  | { type: "sources"; citations: any[]; sources_count: number }
  | { type: "token"; text: string }
  | {
      type: "done"
      session_id: string
      citations: any[]
      metadata: any
      // Present on a real stream; absent when the blocking endpoint stands in.
      user_message_id?: string
      user_created_at?: string
      assistant_message_id?: string
      assistant_created_at?: string
    }
  | { type: "error"; message: string }

function parseFrame(frame: string): StreamEvent | null {
  let event = ""
  let data = ""

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    if (line.startsWith("event: ")) event = line.slice(7)
    else if (line.startsWith("data: ")) data += line.slice(6)
  }

  if (!event || !data) return null

  try {
    return { type: event, ...JSON.parse(data) } as StreamEvent
  } catch {
    console.error("Could not parse stream frame:", frame.slice(0, 120))
    return null
  }
}

/**
 * Calls /api/research/stream and yields each server-sent event as it arrives.
 * Pass an AbortSignal to stop the answer early; the server then saves nothing.
 */
export async function* streamResearch(
  payload: ResearchPayload,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  // authFetch, not fetch: the backend scopes the session to the caller, and a
  // follow-up's session_id is only honoured if this user owns it.
  const response = await authFetch(`${API_URL}/api/research/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  })

  // A 429 has already been turned into a RateLimitedError by authFetch and
  // never reaches here. Anything else keeps its status, so a caller deciding
  // whether to retry does not have to parse the message.
  if (!response.ok || !response.body) {
    const error = new Error(`Stream request failed (${response.status})`) as Error & {
      status?: number
    }
    error.status = response.status
    throw error
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // A chunk can split a frame in half, so keep the remainder in the buffer
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const event = parseFrame(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event) yield event
        boundary = buffer.indexOf("\n\n")
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
