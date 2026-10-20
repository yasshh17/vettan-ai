"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Copy } from "lucide-react"
import {
  DRAFT_KEY,
  MAX_QUESTION,
  bindDraftTo,
  readDraft,
  readPendingQuestion,
  savePendingQuestion,
  subscribePendingQuestion,
  visibleTo,
  writeDraft,
} from "@/lib/pending-question"
import { useSessionState } from "../use-session-state"

export { DRAFT_KEY }

type Status = "idle" | "busy" | "signedOut" | "opening" | "saveFailed"
type CopyState = "idle" | "copied" | "selected"

const panel = "mt-3 rounded-v-card border border-v-accent-line bg-v-wash p-4"

// Start research saves the question and hands it to Vettan; it never starts a run by itself.
// Signed-out visitors are sent to sign in first, signed-in ones to /app with it pre-filled.
export function ResearchField() {
  const id = useId()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const { state: session, userId, resolve } = useSessionState()
  // Read by handlers that run between renders.
  const userIdRef = useRef<string | null>(null)
  userIdRef.current = userId
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [returned, setReturned] = useState(false)
  const [copy, setCopy] = useState<CopyState>("idle")
  const trimmed = query.trim()

  useEffect(() => {
    let active = true
    // Only what this visitor may see: anything unowned straight away, and a signed-in user's
    // own question once the session says who's here. Someone else's is left alone, unshown.
    const restore = async () => {
      const draft = readDraft()
      const pending = readPendingQuestion()
      const needsUser = Boolean(draft?.owner || pending?.owner)
      const who = needsUser ? (await resolve()).userId : null
      if (!active) return
      if (draft && visibleTo(draft, who)) {
        setQuery((q) => q || draft.text)
      } else if (pending && visibleTo(pending, who)) {
        setQuery((q) => q || pending.text)
        setReturned(true)
      }
    }
    restore()
    // Another tab used, removed or handed over the question: stop saying it's kept. A question
    // claimed elsewhere takes this tab's matching draft with it.
    const unsubscribe = subscribePendingQuestion((entry) => {
      if (entry) bindDraftTo(entry)
      if (entry && visibleTo(entry, userIdRef.current)) return
      setReturned(false)
      setStatus((s) => (s === "signedOut" ? "idle" : s))
    })
    return () => {
      active = false
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The account changed while this page was open: drop a restored question that isn't theirs.
  useEffect(() => {
    if (session === "unknown") return
    const shown = query.trim()
    if (!shown) return
    const notTheirs = (x: { text: string; owner?: string } | null) => x && x.text.trim() === shown && !visibleTo(x, userId)
    if (notTheirs(readDraft()) || notTheirs(readPendingQuestion())) {
      setQuery("")
      setReturned(false)
      setStatus("idle")
    }
    // Runs when the account changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, userId])

  const update = (value: string) => {
    setQuery(value)
    setStatus("idle")
    setReturned(false)
    setCopy("idle")
    writeDraft(value, userIdRef.current)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!trimmed || status === "busy" || status === "opening") return
    setReturned(false)
    setStatus("busy")
    // Waits for the first session lookup, so a press during loading never goes the wrong way,
    // and a signed-in visitor's question is saved as theirs.
    const current = await resolve()
    const saved = savePendingQuestion(trimmed, Date.now(), current.state === "signedIn" ? current.userId : null)
    if (!saved) {
      setStatus("saveFailed")
      return
    }
    if (current.state === "signedIn") {
      setStatus("opening")
      router.push("/app")
      return
    }
    setStatus("signedOut")
  }

  const copyQuestion = async () => {
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopy("copied")
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
      setCopy("selected")
    }
  }

  const signedIn = session === "signedIn"

  return (
    <form onSubmit={submit} noValidate className="w-full max-w-[560px]">
      <label htmlFor={`${id}-q`} className="sr-only">
        Research question
      </label>
      <div className="lv2-field flex flex-col gap-1.5 rounded-[12px] border border-v-line-3 bg-v-surface-2 p-1.5 transition-colors focus-within:border-v-accent-line-2 min-[400px]:flex-row min-[400px]:items-center">
        <input
          ref={inputRef}
          id={`${id}-q`}
          value={query}
          onChange={(e) => update(e.target.value)}
          maxLength={MAX_QUESTION}
          placeholder="Ask a research question…"
          autoComplete="off"
          enterKeyHint="go"
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[16px] text-v-ink-1 placeholder:text-v-ink-4"
        />
        <button
          type="submit"
          disabled={!trimmed}
          aria-busy={status === "busy" || undefined}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-v-button bg-v-violet-400 px-5 text-[14px] font-semibold text-v-on-violet transition-[transform,box-shadow] duration-150 enabled:hover:-translate-y-0.5 enabled:hover:shadow-v-glow enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Start research
        </button>
      </div>
      {query.length > MAX_QUESTION - 200 ? (
        <p className="mt-2 text-right font-v-mono text-[12px] text-v-ink-4">
          {query.length} / {MAX_QUESTION}
        </p>
      ) : null}
      <p className="mt-2.5 text-[13px] leading-[1.5] text-v-ink-3">
        {signedIn ? "Your question will open in Vettan." : "You'll sign in or create an account first. Your question is kept."}
      </p>
      {returned && !signedIn && status === "idle" ? (
        <p className="mt-1 text-[13px] leading-[1.5] text-v-ink-3">
          You haven&apos;t signed in yet. Your question is still here when you&apos;re ready.
        </p>
      ) : null}

      <div role="status" aria-live="polite">
        {status === "signedOut" ? (
          <div className={panel}>
            <p className="text-[14.5px] font-semibold text-v-ink-1">Next: sign in or create an account</p>
            <p className="mt-1 text-[13.5px] leading-[1.55] text-v-ink-2">
              Your question is kept and waiting in Vettan. Research starts when you press Start research.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href="/sign-up"
                className="inline-flex min-h-11 items-center rounded-v-button bg-v-violet-400 px-4 text-[13.5px] font-semibold text-v-on-violet no-underline transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-v-glow"
              >
                Create account
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex min-h-11 items-center rounded-v-button border border-v-line-3 px-3 text-[13.5px] font-medium text-v-ink-1 no-underline"
              >
                Sign in
              </Link>
            </div>
          </div>
        ) : null}
        {status === "opening" ? (
          <div className={panel}>
            <p className="flex items-center gap-2 text-[14.5px] font-semibold text-v-ink-1">
              <span
                aria-hidden="true"
                className="size-3.5 animate-spin rounded-full border-2 border-[rgb(182_172_255/0.35)] border-t-v-violet-300 motion-reduce:animate-none"
              />
              Opening Vettan with your question…
            </p>
            <p className="mt-1 text-[13.5px] leading-[1.55] text-v-ink-2">
              You&apos;re signed in, so it&apos;ll be ready for you to start.
            </p>
          </div>
        ) : null}
        {status === "saveFailed" ? (
          <div className={panel}>
            <p className="text-[14.5px] font-semibold text-v-ink-1">This browser couldn&apos;t keep your question</p>
            <p className="mt-1 text-[13.5px] leading-[1.55] text-v-ink-2">
              Copy it, then paste it into Vettan {signedIn ? "to start." : "after you sign in."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyQuestion}
                className="inline-flex min-h-11 items-center gap-2 rounded-v-button border border-v-line-3 bg-v-surface-2 px-4 text-[13.5px] font-medium text-v-ink-1 transition-colors hover:border-v-line-hover"
              >
                {copy === "copied" ? (
                  <Check aria-hidden="true" className="size-4 text-v-violet-300" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
                {copy === "copied" ? "Copied" : "Copy question"}
              </button>
              <Link
                href={signedIn ? "/app" : "/sign-in"}
                className="inline-flex min-h-11 items-center px-2 text-[13.5px] font-medium text-v-violet-300 underline-offset-4 hover:underline"
              >
                {signedIn ? "Open Vettan" : "Sign in"}
              </Link>
            </div>
            {copy === "selected" ? (
              <p className="mt-2 text-[12.5px] text-v-ink-3">
                Couldn&apos;t copy automatically. The question is selected, so press Ctrl+C or ⌘C.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  )
}
