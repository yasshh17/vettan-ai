// The /app empty-state suggestion chips must not go stale with a hard-coded year.
import { cleanup, render, screen } from "@testing-library/react"
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
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authPost: vi.fn(),
  authGet: vi.fn(async () => ({ ratings: {} })),
  withAuthRedirect: (fn: () => Promise<unknown>) => fn(),
}))
vi.mock("@/lib/research-stream", () => ({ streamResearch: vi.fn() }))
vi.mock("@/components/layout/sidebar", () => ({ default: () => null }))
vi.mock("@/components/research/voice-mode", () => ({ VoiceMode: () => null }))
vi.mock("@/components/research/audio-player", () => ({ AudioPlayer: () => null }))

const { default: AppPage } = await import("@/app/app/page")

let network: string[] = []

beforeEach(() => {
  network = blockNetwork()
  localStorage.clear()
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
})
afterEach(() => {
  expect(network).toEqual([])
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("empty-state suggestion chips", () => {
  it("never shows a hard-coded year", async () => {
    render(<AppPage />)
    expect(await screen.findByText(/How do RAG systems work\?/)).toBeInTheDocument()
    expect(screen.queryByText(/2025/)).toBeNull()
  })
})
