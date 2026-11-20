/**
 * Usage events from the browser. Sent only while consent is known to be granted,
 * never with Global Privacy Control on and never in development. Events made
 * before that are dropped, not kept for later. Rules: docs/analytics.md.
 */
import { API_BASE_URL, getAccessToken } from "@/lib/auth-fetch"
import { consentState, onConsentChange } from "@/lib/analytics-consent"

const ROUTES = {
  "/": "home",
  "/app": "app",
  "/sign-in": "sign_in",
  "/sign-up": "sign_up",
  "/forgot-password": "forgot_password",
  "/reset-password": "reset_password",
  "/privacy": "privacy",
  "/terms": "terms",
  "/usage-policy": "usage_policy",
} as const

export type Route = (typeof ROUTES)[keyof typeof ROUTES] | "other"

type NoProps = Record<string, never>

// Must match BROWSER_EVENTS in backend/utils/product_events.py.
interface EventProps {
  page_viewed: { route: Route }
  signed_in: NoProps
  signed_out: NoProps
  sources_expanded: { count: number }
  citation_clicked: NoProps
  audio_downloaded: NoProps
  history_searched: NoProps
}

export type UsageEvent = keyof EventProps

type Queued = { event: UsageEvent; props: object; visit_id: string }

const EVENTS_URL = `${API_BASE_URL}/api/events`
const BATCH_MS = 5000
const MAX_BATCH = 20
const MAX_QUEUED = 100
const LEAVE_WAIT_MS = 1000

let queue: Queued[] = []
// One per page load, in memory only.
let visitId: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
// Kept so a send while the page is closing doesn't have to wait for one.
let token: string | null = null
// The server said it won't store anything, until consent changes again.
let stopped = false

export function routeName(pathname: string): Route {
  return ROUTES[pathname as keyof typeof ROUTES] ?? "other"
}

export function trackingAllowed(): boolean {
  if (typeof window === "undefined" || process.env.NODE_ENV === "development") return false
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl !== true
}

function reset() {
  queue = []
  visitId = null
  if (timer) clearTimeout(timer)
  timer = null
}

onConsentChange(() => {
  reset()
  stopped = false
})

export function track<E extends UsageEvent>(
  event: E,
  ...args: EventProps[E] extends NoProps ? [] : [EventProps[E]]
): void {
  if (stopped || consentState() !== "granted" || !trackingAllowed()) return
  if (queue.length >= MAX_QUEUED) return
  visitId ??= crypto.randomUUID()
  queue.push({ event, props: args[0] ?? {}, visit_id: visitId })
  if (!timer) {
    timer = setTimeout(() => {
      timer = null
      void sendLater()
    }, BATCH_MS)
    getAccessToken().then((t) => (token = t ?? token), () => {})
  }
}

function takeBatches(): Queued[][] {
  const batches: Queued[][] = []
  while (queue.length) batches.push(queue.splice(0, MAX_BATCH))
  return batches
}

// A batch that fails is dropped, never retried.
function post(events: Queued[], auth: string, keepalive: boolean): Promise<void> {
  return fetch(EVENTS_URL, {
    method: "POST",
    keepalive,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  })
    .then(async (res) => {
      if (res.ok && (await res.json())?.stop) {
        stopped = true
        reset()
      }
    })
    .catch(() => {})
}

async function sendLater(): Promise<void> {
  const auth = await getAccessToken().catch(() => null)
  if (auth) token = auth
  const batches = takeBatches()
  if (!auth) return
  await Promise.all(batches.map((batch) => post(batch, auth, false)))
}

// keepalive lets the request finish after the page has gone.
function sendNow(): Promise<void> {
  const auth = token
  // Without a token, leave the queue for the timer.
  if (!auth || !queue.length) return Promise.resolve()
  if (timer) clearTimeout(timer)
  timer = null
  return Promise.all(takeBatches().map((batch) => post(batch, auth, true))).then(() => {})
}

/** Before leaving on purpose, e.g. sign-out. Waits a second at most. */
export function flushEvents(): Promise<void> {
  const send = (async () => {
    token = (await getAccessToken().catch(() => null)) ?? token
    await sendNow()
  })()
  return Promise.race([send, new Promise<void>((resolve) => setTimeout(resolve, LEAVE_WAIT_MS))])
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void sendNow())
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void sendNow()
  })
}
