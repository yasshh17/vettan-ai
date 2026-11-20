import { CONSENT_WORDING_VERSION } from "@/content/legal/meta"
import { API_BASE_URL, authGet, authPost, authPut } from "@/lib/auth-fetch"

export const CONSENT_LABEL =
  "Help improve Vettan. Link what I do in the app, like features used, to a coded ID. " +
  "Never my questions or answers. I can turn this off anytime in Settings."

// These two match the Privacy Policy word for word. Neither may state a deadline.
export const WITHDRAWAL_NOTE =
  "Turning off product analytics stops new linked analytics immediately. We delete linked " +
  "usage history as soon as possible. If a temporary technical issue prevents immediate " +
  "completion, we keep linked analytics off, continue retrying securely, and show a notice " +
  "in Vettan the next time you use it when deletion is complete."

export const ACCOUNT_DELETION_NOTE =
  "Your chats are deleted immediately. If we cannot immediately finish deleting linked usage " +
  "data, your account remains disabled while we complete that work. We will not restore " +
  "access during this process."

export const WITHDRAWAL_PENDING = "Product analytics is off. We're still deleting your linked usage history."
export const WITHDRAWAL_DONE = "Your linked usage history has been deleted."

const CONSENT_URL = `${API_BASE_URL}/api/analytics/consent`

export interface ConsentStatus {
  decided: boolean
  granted: boolean
  erasure_pending: boolean
  erasure_completed: boolean
}

/** What this page knows. "unknown" until the server answers; "off" covers undecided too. */
export type ConsentState = "unknown" | "granted" | "off"

let state: ConsentState = "unknown"
const listeners = new Set<(state: ConsentState) => void>()
let asked = 0
let applied = 0
let reading: Promise<ConsentStatus> | null = null

export const consentState = (): ConsentState => state

export function onConsentChange(listener: (state: ConsentState) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Answers apply in the order they were asked, so an older read can't undo a newer save.
function follow(request: Promise<ConsentStatus>): Promise<ConsentStatus> {
  const n = ++asked
  return request.then((status) => {
    if (n > applied) {
      applied = n
      const next = status.granted ? "granted" : "off"
      if (next !== state) {
        state = next
        listeners.forEach((listener) => listener(next))
      }
    }
    return status
  })
}

/** Callers at the same time share one request. */
export function getConsent(): Promise<ConsentStatus> {
  reading ??= follow(authGet<ConsentStatus>(CONSENT_URL)).finally(() => {
    reading = null
  })
  return reading
}

export const saveConsent = (granted: boolean, source: "signup" | "prompt" | "settings") =>
  follow(authPut<ConsentStatus>(CONSENT_URL, { granted, source, wording_version: CONSENT_WORDING_VERSION }))

export const ackErasureNotice = () => follow(authPost<ConsentStatus>(`${CONSENT_URL}/notice`, {}))
