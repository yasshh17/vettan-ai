// The page-level guard on its own: the search bar is stubbed so the test controls when it
// reports the restore, which lets a conversation start in between.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The signed-in user /app sees; each test can switch it.
let currentUser = "user-a"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: currentUser } } } }) } }),
}))
vi.mock("@/lib/api", () => ({ refreshHistory: vi.fn(), confirmSessionSaved: vi.fn() }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authGet: () => new Promise(() => {}),
  withAuthRedirect: (fn: () => Promise<unknown>) => fn(),
}))

let openSession: ((query: string, sessionId?: string) => void) | null = null
vi.mock("@/components/layout/sidebar", () => ({
  default: ({ onSelectQuery }: { onSelectQuery: (q: string, id?: string) => void }) => {
    openSession = onSelectQuery
    return null
  },
}))
vi.mock("@/components/research/voice-mode", () => ({ VoiceMode: () => null }))
vi.mock("@/components/research/audio-player", () => ({ AudioPlayer: () => null }))

type BarProps = {
  restoredQuery?: { text: string; id: number; pendingId?: string; ifEmpty?: boolean } | null
  onRestoredQueryApplied?: (id: string, outcome: "applied" | "declined") => void
}
let lastBar: BarProps = {}
vi.mock("@/components/research/sticky-search-bar", () => ({
  StickySearchBar: (props: BarProps) => {
    lastBar = props
    return null
  },
}))

const { savePendingQuestion, readPendingQuestion } = await import("@/lib/pending-question")
const { default: AppPage } = await import("@/app/app/page")

beforeEach(() => {
  localStorage.clear()
  lastBar = {}
  currentUser = "user-a"
})

// The offer waits for the session lookup.
const settled = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
afterEach(cleanup)

describe("/app restore guard", () => {
  it("asks for the restore only into an empty bar, tagged with the kept question's id", async () => {
    const kept = savePendingQuestion("kept question")!
    render(<AppPage />)
    await settled()
    expect(lastBar.restoredQuery).toMatchObject({ text: "kept question", pendingId: kept.id, ifEmpty: true })
  })

  it("abandons the restore and keeps the question if a conversation opened first", async () => {
    const kept = savePendingQuestion("kept question")!
    render(<AppPage />)
    await settled()
    const report = lastBar.onRestoredQueryApplied!
    act(() => openSession?.("older question", "session-1"))
    act(() => report(kept.id, "applied"))
    expect(readPendingQuestion()?.id).toBe(kept.id)
    expect(screen.queryByText(/We kept your question/)).toBeNull()
  })

  it("keeps the question and offers it when the bar already held a draft", async () => {
    const kept = savePendingQuestion("kept question")!
    render(<AppPage />)
    await settled()
    act(() => lastBar.onRestoredQueryApplied!(kept.id, "declined"))
    expect(readPendingQuestion()?.id).toBe(kept.id)
    expect(screen.getByRole("button", { name: "Use question from homepage" })).toBeInTheDocument()
    act(() => screen.getByRole("button", { name: "Use question from homepage" }).click())
    expect(lastBar.restoredQuery).toMatchObject({ text: "kept question", pendingId: kept.id })
    expect(lastBar.restoredQuery?.ifEmpty).toBeUndefined()
  })

  it("showing the question in the bar doesn't forget the saved copy", async () => {
    const kept = savePendingQuestion("kept question")!
    render(<AppPage />)
    await settled()
    act(() => lastBar.onRestoredQueryApplied!(kept.id, "applied"))
    expect(readPendingQuestion()?.id).toBe(kept.id)
    expect(screen.getByText(/We kept your question from the homepage/)).toBeInTheDocument()
  })

  it("discards another account's question and never offers it", async () => {
    const kept = savePendingQuestion("user A's private question", Date.now(), "user-a")!
    currentUser = "user-b"
    render(<AppPage />)
    await settled()
    expect(lastBar.restoredQuery ?? null).toBeNull()
    expect(screen.queryByText(/user A's private question|We kept your question/)).toBeNull()
    expect(readPendingQuestion()).toBeNull()
    expect(kept.owner).toBe("user-a")
  })

  it("claims a question typed while signed out for the user it's restored for", async () => {
    const kept = savePendingQuestion("typed before signing in")!
    expect(kept.owner).toBeUndefined()
    render(<AppPage />)
    await settled()
    expect(lastBar.restoredQuery).toMatchObject({ text: "typed before signing in", pendingId: kept.id })
    expect(readPendingQuestion()).toMatchObject({ id: kept.id, owner: "user-a", savedAt: kept.savedAt })
  })

  it("offers a user their own question again", async () => {
    const kept = savePendingQuestion("my own question", Date.now(), "user-a")!
    render(<AppPage />)
    await waitFor(() => expect(lastBar.restoredQuery).toMatchObject({ pendingId: kept.id }))
  })
})
