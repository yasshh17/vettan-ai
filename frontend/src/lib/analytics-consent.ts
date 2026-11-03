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

export const getConsent = () => authGet<ConsentStatus>(CONSENT_URL)

export const saveConsent = (granted: boolean, source: "prompt" | "settings") =>
  authPut<ConsentStatus>(CONSENT_URL, { granted, source, wording_version: CONSENT_WORDING_VERSION })

export const ackErasureNotice = () => authPost<ConsentStatus>(`${CONSENT_URL}/notice`, {})
