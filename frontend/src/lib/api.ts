
import axios from 'axios'
import { mutate } from 'swr'
import { API_BASE_URL, authGet, authPost, authDelete } from '@/lib/auth-fetch'

// Base URL of the history list. The sidebar does NOT subscribe to this string
// directly — it keys on the tuple [HISTORY_URL, userId] so one account's cached
// history can never be served to the next account in the same browser.
export const HISTORY_URL = `${API_BASE_URL}/api/history`

export { API_BASE_URL }

/**
 * Revalidate the sidebar history after a search.
 *
 * Matches by predicate rather than by exact key. Call sites therefore never
 * need the user id, and the key shape has exactly one owner — the sidebar.
 *
 * This previously called `mutate(HISTORY_URL)` with the bare string. Once the
 * sidebar moved to a tuple key, SWR hashed the two differently, the refresh
 * signal landed on a cache entry nobody subscribed to, and new searches only
 * appeared on the 60s poll. Matching structurally makes that class of drift
 * impossible.
 */
export const refreshHistory = () =>
  mutate((key) => Array.isArray(key) && key[0] === HISTORY_URL)

/**
 * Did this session actually reach the user's history?
 *
 * Saves run in a background task after the answer is streamed, so a rejected
 * write used to be invisible: the answer appeared, the row never existed, and
 * nothing said so. `GET /api/history` waits for pending saves before it
 * responds, so a session missing from that response really was not saved
 * rather than still being written.
 *
 * Reuses the revalidation the sidebar performs anyway, and only falls back to
 * its own request if that result is not usable. Returns true on any error: a
 * network hiccup must never accuse the backend of losing someone's work.
 */
export async function confirmSessionSaved(sessionId: string): Promise<boolean> {
  try {
    const revalidated = await refreshHistory()

    for (const entry of revalidated ?? []) {
      const sessions = (entry as { sessions?: Array<{ id: string }> })?.sessions
      if (Array.isArray(sessions)) {
        return sessions.some((s) => s.id === sessionId)
      }
    }

    const data = await authGet<{ sessions: Array<{ id: string }> }>(HISTORY_URL)
    return data.sessions.some((s) => s.id === sessionId)
  } catch {
    return true
  }
}

export interface ResearchRequest {
  query: string
  max_iterations?: number
  use_cache?: boolean
}

export interface ResearchResponse {
  output: string
  citations: Array<{
    domain: string
    url: string
  }>
  metadata: {
    iterations: number
    estimated_cost: number
    from_cache: boolean
  }
}

export const api = {
  research: async (request: ResearchRequest): Promise<ResearchResponse> => {
    return authPost<ResearchResponse>(`${API_BASE_URL}/api/research`, request)
  },

  getHistory: async () => {
    const data = await authGet<{ sessions: unknown[] }>(`${API_BASE_URL}/api/history`)
    return data.sessions
  },

  deleteAccount: async (accessToken?: string): Promise<{ success: boolean; message: string }> => {
    // Callers that already hold a token may pass it; otherwise the shared
    // helper reads the current session.
    if (accessToken) {
      const response = await axios.delete(`${API_BASE_URL}/api/account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return response.data
    }
    return authDelete<{ success: boolean; message: string }>(`${API_BASE_URL}/api/account`)
  }
}
