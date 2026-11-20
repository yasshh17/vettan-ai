// The usage-event tracker: nothing leaves the browser unless consent is granted, and the
// per-visit ID lives in memory only. Rules: docs/analytics.md, "Usage events".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authGet = vi.fn()
const authPut = vi.fn()
const authPost = vi.fn()
vi.mock("@/lib/auth-fetch", () => ({
  API_BASE_URL: "https://api.test",
  authGet: (...a: unknown[]) => authGet(...a),
  authPut: (...a: unknown[]) => authPut(...a),
  authPost: (...a: unknown[]) => authPost(...a),
  getAccessToken: async () => "tok",
}))

const granted = { decided: true, granted: true, erasure_pending: false, erasure_completed: false }
const declined = { ...granted, granted: false }

type Sent = { url: string; init: RequestInit; body: { events: { event: string; props: object; visit_id: string }[] } }
let sent: Sent[] = []
let reply: Record<string, unknown> = { stored: 1, stop: false }

async function load() {
  vi.resetModules()
  const consent = await import("@/lib/analytics-consent")
  const analytics = await import("@/lib/analytics")
  return { consent, analytics }
}

async function loadGranted() {
  const mods = await load()
  authGet.mockResolvedValueOnce(granted)
  await mods.consent.getConsent()
  return mods
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  sent = []
  reply = { stored: 1, stop: false }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init, body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => reply }
    })
  )
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  delete (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl
})

describe("tracker", () => {
  it("discards events while consent is unknown", async () => {
    const { analytics } = await load()
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).toEqual([])
  })

  it("discards events when consent is off, and doesn't keep them for a later grant", async () => {
    const { consent, analytics } = await load()
    authGet.mockResolvedValueOnce(declined)
    await consent.getConsent()
    analytics.track("signed_in")
    authPut.mockResolvedValueOnce(granted)
    await consent.saveConsent(true, "settings")
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).toEqual([])
  })

  it("sends a batch every 5 seconds once consent is granted", async () => {
    const { analytics } = await loadGranted()
    analytics.track("page_viewed", { route: "app" })
    analytics.track("sources_expanded", { count: 3 })
    await vi.advanceTimersByTimeAsync(4900)
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(200)

    expect(sent).toHaveLength(1)
    const [{ url, init, body }] = sent
    expect(url).toBe("https://api.test/api/events")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
    expect(body.events.map((e) => [e.event, e.props])).toEqual([
      ["page_viewed", { route: "app" }],
      ["sources_expanded", { count: 3 }],
    ])
    expect(Object.keys(body)).toEqual(["events"])
  })

  it("uses one visit_id per page load, held in memory only", async () => {
    const { analytics } = await loadGranted()
    analytics.track("signed_in")
    analytics.track("citation_clicked")
    await vi.advanceTimersByTimeAsync(5000)

    const ids = sent[0].body.events.map((e) => e.visit_id)
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(ids[1]).toBe(ids[0])
    const stored = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie]
    expect(stored.join(" ")).not.toContain(ids[0])

    const next = await loadGranted()
    next.analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent[1].body.events[0].visit_id).not.toBe(ids[0])
  })

  it("never sends with Global Privacy Control on", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true })
    const { analytics } = await loadGranted()
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).toEqual([])
    expect(analytics.trackingAllowed()).toBe(false)
  })

  it("never sends in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const { analytics } = await loadGranted()
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).toEqual([])
  })

  it("drops queued events and the visit_id on withdrawal", async () => {
    const { consent, analytics } = await loadGranted()
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(5000)
    const first = sent[0].body.events[0].visit_id

    analytics.track("citation_clicked")
    authPut.mockResolvedValueOnce(declined)
    await consent.saveConsent(false, "settings")
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).toHaveLength(1)

    authPut.mockResolvedValueOnce(granted)
    await consent.saveConsent(true, "settings")
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent).toHaveLength(2)
    expect(sent[1].body.events.map((e) => e.event)).toEqual(["signed_in"])
    expect(sent[1].body.events[0].visit_id).not.toBe(first)
  })

  it("stops when the server says nothing will be stored", async () => {
    const { analytics } = await loadGranted()
    reply = { stored: 0, stop: true }
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(5000)
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).toHaveLength(1)
  })

  it("sends at most 20 events per request", async () => {
    const { analytics } = await loadGranted()
    for (let i = 0; i < 25; i++) analytics.track("citation_clicked")
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.map((s) => s.body.events.length)).toEqual([20, 5])
  })

  it("doesn't retry a batch that failed to send", async () => {
    const { analytics } = await loadGranted()
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"))
    analytics.track("signed_in")
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(10000)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it("sends what's queued with keepalive when the page is hidden", async () => {
    const { analytics } = await loadGranted()
    analytics.track("audio_downloaded")
    // The token is read once the first event is queued.
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event("pagehide"))
    expect(sent).toHaveLength(1)
    expect(sent[0].init.keepalive).toBe(true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).toHaveLength(1)
  })

  it("keeps the queue for the timer if the page hides before the token is known", async () => {
    const { analytics } = await loadGranted()
    analytics.track("signed_in")
    window.dispatchEvent(new Event("pagehide"))
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.map((s) => s.init.keepalive)).toEqual([false])
  })

  it("flushEvents sends now, and gives up waiting after a second", async () => {
    const { analytics } = await loadGranted()
    vi.mocked(fetch).mockImplementationOnce((url, init) => {
      sent.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) })
      return new Promise(() => {})
    })
    analytics.track("signed_out")
    let done = false
    void analytics.flushEvents().then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.map((s) => s.body.events[0].event)).toEqual(["signed_out"])
    expect(sent[0].init.keepalive).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toBe(true)
  })
})

describe("routeName", () => {
  it("maps paths to the fixed list and nothing else", async () => {
    const { analytics } = await load()
    expect(analytics.routeName("/")).toBe("home")
    expect(analytics.routeName("/app")).toBe("app")
    expect(analytics.routeName("/sign-in")).toBe("sign_in")
    expect(analytics.routeName("/usage-policy")).toBe("usage_policy")
    expect(analytics.routeName("/app/some-chat-id")).toBe("other")
    expect(analytics.routeName("/preview/landing")).toBe("other")
  })
})

describe("consent state", () => {
  it("starts unknown, and follows reads and saves", async () => {
    const { consent } = await load()
    const seen: string[] = []
    consent.onConsentChange((s) => seen.push(s))
    expect(consent.consentState()).toBe("unknown")
    authGet.mockResolvedValueOnce(granted)
    await consent.getConsent()
    authPut.mockResolvedValueOnce(declined)
    await consent.saveConsent(false, "settings")
    expect(seen).toEqual(["granted", "off"])
  })

  it("an older read can't undo a newer save", async () => {
    const { consent } = await load()
    let answerRead: (v: unknown) => void = () => {}
    authGet.mockReturnValueOnce(new Promise((r) => (answerRead = r)))
    const read = consent.getConsent()
    authPut.mockResolvedValueOnce(declined)
    await consent.saveConsent(false, "settings")
    answerRead(granted)
    await read
    expect(consent.consentState()).toBe("off")
  })

  it("shares one request between callers", async () => {
    const { consent } = await load()
    authGet.mockResolvedValueOnce(granted)
    const [a, b] = await Promise.all([consent.getConsent(), consent.getConsent()])
    expect(a).toBe(b)
    expect(authGet).toHaveBeenCalledTimes(1)
  })
})
