// A question typed on the landing page, kept on this device while the visitor signs in.
// localStorage rather than sessionStorage: the email confirmation link opens a new tab.
// Nothing here ever starts research; /app only pre-fills its input with it.
//
// Ownership keeps it private on a shared browser. A question typed while signed out has no
// owner, so it can follow the visitor through sign-in or sign-up. Once a signed-in user saves it
// or /app restores it, it carries that user's id and is shown to no one else, even if their
// session ends without signing out and someone else signs in.
export const PENDING_KEY = "vettan:pendingQuestion"
export const MAX_QUESTION = 2000
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000

export interface PendingQuestion {
  v: 1
  id: string
  text: string
  savedAt: number
  owner?: string
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function parse(raw: string | null, now: number): PendingQuestion | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<PendingQuestion>
    if (p.v !== 1 || typeof p.id !== "string" || typeof p.text !== "string" || typeof p.savedAt !== "number") return null
    const text = p.text.trim()
    if (!text || text.length > MAX_QUESTION) return null
    if (now - p.savedAt > PENDING_TTL_MS || p.savedAt > now + 60_000) return null
    const entry: PendingQuestion = { v: 1, id: p.id, text, savedAt: p.savedAt }
    if (typeof p.owner === "string" && p.owner) entry.owner = p.owner
    return entry
  } catch {
    return null
  }
}

export function savePendingQuestion(text: string, now = Date.now(), owner?: string | null): PendingQuestion | null {
  const trimmed = text.trim().slice(0, MAX_QUESTION)
  if (!trimmed) return null
  const entry: PendingQuestion = { v: 1, id: newId(), text: trimmed, savedAt: now }
  if (owner) entry.owner = owner
  try {
    const s = storage()
    if (!s) return null
    s.setItem(PENDING_KEY, JSON.stringify(entry))
    return entry
  } catch {
    return null
  }
}

// Returns a usable question or null. Stale or malformed entries are removed on the way.
export function readPendingQuestion(now = Date.now()): PendingQuestion | null {
  try {
    const s = storage()
    if (!s) return null
    const raw = s.getItem(PENDING_KEY)
    const entry = parse(raw, now)
    if (raw && !entry) s.removeItem(PENDING_KEY)
    return entry
  } catch {
    return null
  }
}

// Who may see a question: anyone while it's unowned, otherwise only its owner.
export function visibleTo(entry: { owner?: string }, userId: string | null | undefined): boolean {
  return !entry.owner || entry.owner === userId
}

// Binds an unowned question to the user it was restored for. Its id and age don't change, so
// the 24-hour expiry still counts from when it was typed.
export function claimPendingQuestion(id: string, owner: string): PendingQuestion | null {
  try {
    const s = storage()
    if (!s) return null
    const current = parse(s.getItem(PENDING_KEY), Date.now())
    if (!current || current.id !== id) return null
    if (current.owner && current.owner !== owner) return null
    const claimed = { ...current, owner }
    s.setItem(PENDING_KEY, JSON.stringify(claimed))
    return claimed
  } catch {
    return null
  }
}

// With an id, only that question is removed, so a newer one saved in another tab survives.
export function clearPendingQuestion(id?: string): void {
  try {
    const s = storage()
    if (!s) return
    if (id) {
      const current = parse(s.getItem(PENDING_KEY), Date.now())
      if (current && current.id !== id) return
    }
    s.removeItem(PENDING_KEY)
  } catch {}
}

// Unsubmitted text in the landing page's field, per tab, with the same ownership rule.
export const DRAFT_KEY = "vettan:draftQuestion"

export interface Draft {
  text: string
  owner?: string
}

export function readDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    try {
      const d = JSON.parse(raw) as Partial<Draft>
      if (typeof d?.text === "string") {
        const draft: Draft = { text: d.text.slice(0, MAX_QUESTION) }
        if (typeof d.owner === "string" && d.owner) draft.owner = d.owner
        return draft.text.trim() ? draft : null
      }
    } catch {}
    // A plain string from before drafts carried an owner.
    return raw.trim() ? { text: raw.slice(0, MAX_QUESTION) } : null
  } catch {
    return null
  }
}

// A draft that is the same text as a question now owned by someone takes the same owner.
export function bindDraftTo(entry: PendingQuestion): void {
  if (!entry.owner) return
  const d = readDraft()
  if (d && !d.owner && d.text.trim() === entry.text) writeDraft(d.text, entry.owner)
}

export function writeDraft(text: string, owner?: string | null): void {
  try {
    if (!text.trim()) window.sessionStorage.removeItem(DRAFT_KEY)
    else window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(owner ? { text, owner } : { text }))
  } catch {}
}

// Everything this device holds about the visitor's question: the kept one and the draft.
export function forgetQuestionOnThisDevice(): void {
  clearPendingQuestion()
  try {
    window.sessionStorage.removeItem(DRAFT_KEY)
  } catch {}
}

// Changes made in other tabs. The callback gets the current value.
export function subscribePendingQuestion(cb: (entry: PendingQuestion | null) => void): () => void {
  if (typeof window === "undefined") return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === PENDING_KEY || e.key === null) cb(readPendingQuestion())
  }
  window.addEventListener("storage", onStorage)
  return () => window.removeEventListener("storage", onStorage)
}
