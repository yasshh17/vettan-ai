import { authFetch } from "@/lib/auth-fetch"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export interface ResearchPayload {
  query: string
  max_iterations?: number
  use_cache?: boolean
  session_id?: string
  is_followup?: boolean
}

/** "submitted" and "aborted" are client-side; the rest are SSE frames. */
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
      // Absent when the non-streaming endpoint was used as a fallback.
      user_message_id?: string
      user_created_at?: string
      assistant_message_id?: string
      assistant_created_at?: string
    }
  | { type: "error"; message: string }
  /** Refused by moderation: drop anything streamed so far. */
  | { type: "blocked"; message: string }

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

/** Yields events from /api/research/stream. Aborting stops the answer and nothing is saved. */
export async function* streamResearch(
  payload: ResearchPayload,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const response = await authFetch(`${API_URL}/api/research/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  })

  // 429s were already thrown by authFetch. Keep the status for callers deciding on a retry.
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

      // A chunk can end mid-frame.
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
