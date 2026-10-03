
import axios from 'axios'
import { mutate } from 'swr'
import { API_BASE_URL, authGet, authPost, authDelete } from '@/lib/auth-fetch'

// The sidebar keys SWR on [HISTORY_URL, userId], so cached history never crosses accounts.
export const HISTORY_URL = `${API_BASE_URL}/api/history`

export { API_BASE_URL }

/** Revalidate the sidebar history. Matches by predicate so callers don't need the key shape. */
export const refreshHistory = () =>
  mutate((key) => Array.isArray(key) && key[0] === HISTORY_URL)

/**
 * Whether the session reached the user's history. /api/history waits for pending saves,
 * so absent means not saved. Returns true on errors rather than report a false loss.
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
    if (accessToken) {
      const response = await axios.delete(`${API_BASE_URL}/api/account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return response.data
    }
    return authDelete<{ success: boolean; message: string }>(`${API_BASE_URL}/api/account`)
  }
}
