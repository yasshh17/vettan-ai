import { afterEach, describe, expect, it, vi } from "vitest"
import {
  MAX_QUESTION,
  PENDING_KEY,
  PENDING_TTL_MS,
  DRAFT_KEY,
  bindDraftTo,
  claimPendingQuestion,
  clearPendingQuestion,
  readDraft,
  readPendingQuestion,
  visibleTo,
  writeDraft,
  savePendingQuestion,
  subscribePendingQuestion,
} from "@/lib/pending-question"

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe("pending question store", () => {
  it("round-trips a trimmed question", () => {
    const saved = savePendingQuestion("  What is RAG?  ")
    expect(saved?.text).toBe("What is RAG?")
    expect(readPendingQuestion()).toEqual(saved)
  })

  it("refuses empty questions and caps length at 2,000 characters", () => {
    expect(savePendingQuestion("   ")).toBeNull()
    const long = savePendingQuestion("x".repeat(MAX_QUESTION + 50))
    expect(long?.text).toHaveLength(MAX_QUESTION)
  })

  it("expires after 24 hours and removes the stale entry", () => {
    const now = Date.now()
    savePendingQuestion("old question", now - PENDING_TTL_MS - 1)
    expect(readPendingQuestion(now)).toBeNull()
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it("ignores and removes malformed data", () => {
    localStorage.setItem(PENDING_KEY, "{not json")
    expect(readPendingQuestion()).toBeNull()
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
    localStorage.setItem(PENDING_KEY, JSON.stringify({ v: 2, id: "a", text: "x", savedAt: Date.now() }))
    expect(readPendingQuestion()).toBeNull()
  })

  it("survives storage that throws, on write and on read", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    expect(savePendingQuestion("question")).toBeNull()
    vi.restoreAllMocks()
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError")
    })
    expect(readPendingQuestion()).toBeNull()
    expect(() => clearPendingQuestion("x")).not.toThrow()
  })

  it("clear(id) leaves a newer question saved in another tab alone", () => {
    const first = savePendingQuestion("first")!
    const second = savePendingQuestion("second")!
    clearPendingQuestion(first.id)
    expect(readPendingQuestion()?.id).toBe(second.id)
    clearPendingQuestion(second.id)
    expect(readPendingQuestion()).toBeNull()
  })

  it("tells subscribers when another tab changes it", () => {
    const cb = vi.fn()
    const unsubscribe = subscribePendingQuestion(cb)
    savePendingQuestion("from another tab")
    window.dispatchEvent(new StorageEvent("storage", { key: PENDING_KEY }))
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ text: "from another tab" }))
    localStorage.removeItem(PENDING_KEY)
    window.dispatchEvent(new StorageEvent("storage", { key: PENDING_KEY }))
    expect(cb).toHaveBeenLastCalledWith(null)
    unsubscribe()
    window.dispatchEvent(new StorageEvent("storage", { key: PENDING_KEY }))
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it("keeps an owner, and a claim binds an unowned question without changing its age", () => {
    const anon = savePendingQuestion("typed signed out", Date.now() - 3600_000)!
    expect(anon.owner).toBeUndefined()
    const claimed = claimPendingQuestion(anon.id, "user-a")!
    expect(claimed).toMatchObject({ id: anon.id, savedAt: anon.savedAt, owner: "user-a" })
    expect(readPendingQuestion()?.owner).toBe("user-a")
    // Already someone's: another account can't take it over.
    expect(claimPendingQuestion(anon.id, "user-b")).toBeNull()
    expect(readPendingQuestion()?.owner).toBe("user-a")
    // The 24-hour window still counts from when it was typed.
    expect(readPendingQuestion(anon.savedAt + PENDING_TTL_MS + 1)).toBeNull()
  })

  it("shows an unowned question to anyone and an owned one only to its owner", () => {
    expect(visibleTo({}, null)).toBe(true)
    expect(visibleTo({}, "user-b")).toBe(true)
    expect(visibleTo({ owner: "user-a" }, "user-a")).toBe(true)
    expect(visibleTo({ owner: "user-a" }, "user-b")).toBe(false)
    expect(visibleTo({ owner: "user-a" }, null)).toBe(false)
  })

  it("drafts carry an owner, and older plain-text drafts read as unowned", () => {
    writeDraft("mine", "user-a")
    expect(readDraft()).toEqual({ text: "mine", owner: "user-a" })
    writeDraft("anyone's")
    expect(readDraft()).toEqual({ text: "anyone's" })
    sessionStorage.setItem(DRAFT_KEY, "legacy plain draft")
    expect(readDraft()).toEqual({ text: "legacy plain draft" })
    writeDraft("   ")
    expect(readDraft()).toBeNull()
  })

  it("a claimed question takes its matching unowned draft with it", () => {
    writeDraft("same question")
    const entry = savePendingQuestion("same question", Date.now(), "user-a")!
    bindDraftTo(entry)
    expect(readDraft()).toEqual({ text: "same question", owner: "user-a" })
    writeDraft("a different draft")
    bindDraftTo(entry)
    expect(readDraft()).toEqual({ text: "a different draft" })
  })
})
