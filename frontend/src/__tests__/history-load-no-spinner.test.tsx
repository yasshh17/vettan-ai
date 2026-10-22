// Opening a saved report is a plain GET, not a research run, and must not show the
// "Researching..." panel meant for a live run in progress.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
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
vi.mock("@/lib/api", () => ({ refreshHistory: vi.fn(), confirmSessionSaved: vi.fn() }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

let resolveHistory: ((value: unknown) => void) | null = null
const authGet = vi.fn((url: string) => {
  if (url.includes("/api/history/")) {
    return new Promise((resolve) => {
      resolveHistory = resolve
    })
  }
  return Promise.resolve({ ratings: {} })
})
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authPost: vi.fn(),
  authGet: (url: string) => authGet(url),
  withAuthRedirect: (fn: () => Promise<unknown>) => fn(),
}))
vi.mock("@/lib/research-stream", () => ({ streamResearch: vi.fn() }))

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

let network: string[] = []

beforeEach(() => {
  network = blockNetwork()
  localStorage.clear()
  openSession = null
  resolveHistory = null
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

describe("opening a saved report", () => {
  it("never shows the research-in-progress panel while the GET is in flight", async () => {
    render(<AppPage />)
    await act(async () => openSession?.("older question", "session-1"))

    // The GET is still pending (we haven't resolved it yet): neither loading-panel text may appear.
    expect(screen.queryByText(/Analyzing sources and generating report/)).toBeNull()
    expect(screen.queryByText(/^Researching/)).toBeNull()
    expect(screen.queryByText(/^Processing$/)).toBeNull()

    await act(async () =>
      resolveHistory?.({ messages: [{ id: "m1", role: "user", content: "older question", created_at: "" }] })
    )
    await waitFor(() => expect(screen.getAllByText("older question").length).toBeGreaterThan(0))
  })
})
