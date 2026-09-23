"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowUp, Square, Mic, AudioWaveform } from "lucide-react"
import { refreshHistory, confirmSessionSaved } from "@/lib/api"
import { authPost, RateLimitedError } from "@/lib/auth-fetch"
import { streamResearch, type StreamEvent } from "@/lib/research-stream"
import { useToast } from "@/hooks/use-toast"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

interface StickySearchBarProps {
  onResultsUpdate: (result: any) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  hasResults: boolean
  onVoiceModeToggle?: () => void
  currentSessionId?: string | null
  /** Called for every event of a streamed answer: stage, sources, token, done, error. */
  onStreamEvent?: (event: StreamEvent, context: { query: string; isFollowUp: boolean }) => void
  /**
   * Holds the in-flight stream's AbortController. Owned by the page, because this
   * component unmounts mid-stream: submitting swaps the hero search bar for the
   * docked one, so a controller kept in local state would be lost and Stop would
   * quietly do nothing.
   */
  abortRef?: React.MutableRefObject<AbortController | null>
  /**
   * Same reason as abortRef: a query rejected by the rate limiter has nowhere
   * local to land if this instance unmounts before the response comes back.
   * A first-ever query flips isLoading true then back to false with no
   * results yet, which swaps the hero bar out and back in as a fresh
   * instance — setQuery() on the failing (stale) instance would target a
   * component that's already gone. Written on rejection, read once by
   * whichever instance mounts next and cleared immediately after.
   */
  pendingQueryRef?: React.MutableRefObject<string | null>
}

export function StickySearchBar({
  onResultsUpdate,
  isLoading,
  setIsLoading,
  hasResults,
  onVoiceModeToggle,
  currentSessionId,
  onStreamEvent,
  abortRef,
  pendingQueryRef
}: StickySearchBarProps) {
  const { toast } = useToast()
  // Seeded once from any query a previous (now-unmounted) instance couldn't
  // hand back directly. Read-only here on purpose: Next's default
  // reactStrictMode double-invokes a useState initializer on mount in dev
  // and keeps only one result, so an initializer that both reads AND clears
  // the ref would have the two invocations disagree (the second would see it
  // already cleared) and could silently lose the restored text. The clear is
  // a separate effect below, which is idempotent under that same
  // double-invocation.
  const [query, setQuery] = useState(() => pendingQueryRef?.current ?? "")
  const [isFocused, setIsFocused] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [showMicTooltip, setShowMicTooltip] = useState(false)
  const [showVoiceModeTooltip, setShowVoiceModeTooltip] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const localAbortRef = useRef<AbortController | null>(null)
  // Prefer the page-owned ref so Stop still works after this component remounts
  const activeAbortRef = abortRef ?? localAbortRef
  const micTooltipTimer = useRef<number | null>(null)
  const voiceModeTooltipTimer = useRef<number | null>(null)

  // Clears what the initializer above just consumed, so a later, unrelated
  // mount doesn't inherit stale text. Split from the read for the StrictMode
  // reason noted there; setting a ref to null twice (StrictMode's mount ->
  // cleanup -> mount replay) is harmless.
  useEffect(() => {
    if (pendingQueryRef) pendingQueryRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition()
        recognitionRef.current.continuous = false
        recognitionRef.current.interimResults = true
        recognitionRef.current.lang = "en-US"

        recognitionRef.current.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0].transcript)
            .join("")
          setQuery(transcript)
        }

        recognitionRef.current.onend = () => setIsListening(false)
        recognitionRef.current.onerror = (event: any) => {
          console.error("Speech recognition error:", event.error)
          setIsListening(false)
        }
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  const handleStop = () => {
    const controller = activeAbortRef.current
    if (!controller) {
      console.warn("Stop was clicked but no stream controller is registered")
      return
    }
    controller.abort()
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim() || isLoading) return

    const submitted = query
    const isFollowUp = Boolean(currentSessionId && hasResults)
    const payload = {
      query: submitted,
      max_iterations: 25,
      use_cache: true,
      ...(isFollowUp ? { session_id: currentSessionId!, is_followup: true } : {})
    }
    const context = { query: submitted, isFollowUp }

    setIsLoading(true)
    setQuery("")

    // Put the question and an empty answer on screen before the request opens,
    // so the page reacts immediately instead of sitting on the previous view.
    onStreamEvent?.({ type: "submitted" }, context)

    const controller = new AbortController()
    activeAbortRef.current = controller

    try {
      let sawDone = false
      let newSessionId: string | null = null

      for await (const event of streamResearch(payload, controller.signal)) {
        onStreamEvent?.(event, context)

        if (event.type === "done") {
          sawDone = true
          if (!isFollowUp) newSessionId = event.session_id
          // Same shape the non-streaming endpoint returns, so the page's
          // session handling and the history list are updated as before.
          onResultsUpdate({
            output: null,
            citations: event.citations,
            metadata: event.metadata,
            session_id: isFollowUp ? currentSessionId : event.session_id,
            streamed: true
          })
        } else if (event.type === "error") {
          throw new Error(event.message)
        }
      }

      if (!sawDone) throw new Error("The answer ended before it was complete.")

      // The save happens after the stream closes, so its outcome is only
      // knowable now. Checked after the loop so it never stalls token delivery.
      if (newSessionId) {
        if (!(await confirmSessionSaved(newSessionId))) {
          onStreamEvent?.({ type: "not_saved" }, context)
        }
      } else {
        refreshHistory()
      }
    } catch (err) {
      if (controller.signal.aborted) {
        onStreamEvent?.({ type: "aborted" }, context)
      } else if (err instanceof RateLimitedError) {
        // Deliberately NOT falling back to /api/research. It draws on the same
        // bucket, so the retry would either be rejected too or — worse, if the
        // buckets are ever split — quietly spend a second research request's
        // worth of Tavily and OpenAI credits for one user action.
        onStreamEvent?.({ type: "error", message: err.message }, context)
        toast({ title: "Slow down a moment", description: err.message, variant: "destructive" })
        // Nothing ran, so give the question back rather than making them retype
        // it: handleSubmit cleared the input optimistically before the request.
        setQuery(submitted)
        // A follow-up keeps hasResults true throughout, so this same docked
        // instance never remounts — setQuery above is enough, and the ref
        // would just be a value nobody ever reads until some unrelated later
        // mount, wrongly inheriting this text. Only a first-ever query
        // actually remounts (isLoading round-trips true->false with no
        // results, swapping hero->docked->hero) — see pendingQueryRef's doc
        // comment — so only that case needs the hand-off.
        if (!isFollowUp && pendingQueryRef) pendingQueryRef.current = submitted
      } else {
        console.error("Streaming failed, falling back to /api/research:", err)
        await runWithoutStreaming(payload, context, err)
      }
    } finally {
      // Only clear it if it is still ours, never a newer stream's controller
      if (activeAbortRef.current === controller) activeAbortRef.current = null
      setIsLoading(false)
    }
  }

  /** Fallback if streaming fails: the original blocking request. */
  const runWithoutStreaming = async (
    payload: Record<string, any>,
    context: { query: string; isFollowUp: boolean },
    streamError: unknown
  ) => {
    try {
      const data = await authPost<any>(`${API_URL}/api/research`, payload)
      if (context.isFollowUp) data.session_id = currentSessionId
      onStreamEvent?.({ type: "token", text: data.output }, context)
      onStreamEvent?.(
        {
          type: "done",
          session_id: data.session_id,
          citations: data.citations ?? [],
          metadata: data.metadata ?? {}
        },
        context
      )
      onResultsUpdate(data)
      refreshHistory()
    } catch (err) {
      console.error("Research failed:", err)
      // A rate limit hit on the fallback describes the situation better than
      // whatever made the stream fail, so it wins. Otherwise keep reporting the
      // original stream error, which is the more useful diagnosis.
      if (err instanceof RateLimitedError) {
        onStreamEvent?.({ type: "error", message: err.message }, context)
        // Same treatment as the stream's own 429: nothing succeeded here
        // either, so give the text back the same way.
        toast({ title: "Slow down a moment", description: err.message, variant: "destructive" })
        setQuery(context.query)
        // See the matching guard in the stream's own 429 branch above: the
        // ref hand-off is only for a remount, which only happens for a
        // first-ever query.
        if (!context.isFollowUp && pendingQueryRef) pendingQueryRef.current = context.query
      } else {
        const message =
          streamError instanceof Error && streamError.message
            ? streamError.message
            : "Could not reach the research service. Check your connection and try again."
        onStreamEvent?.({ type: "error", message }, context)
      }
    }
  }

  const handleDictate = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition not supported. Use Chrome, Edge, or Safari.")
      return
    }

    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    } else {
      recognitionRef.current.start()
      setIsListening(true)
    }
  }

  const handleMicMouseEnter = () => {
    if (micTooltipTimer.current) window.clearTimeout(micTooltipTimer.current)
    micTooltipTimer.current = window.setTimeout(() => setShowMicTooltip(true), 200)
  }

  const handleMicMouseLeave = () => {
    if (micTooltipTimer.current) window.clearTimeout(micTooltipTimer.current)
    setShowMicTooltip(false)
  }

  const handleVoiceModeMouseEnter = () => {
    if (voiceModeTooltipTimer.current) window.clearTimeout(voiceModeTooltipTimer.current)
    voiceModeTooltipTimer.current = window.setTimeout(() => setShowVoiceModeTooltip(true), 200)
  }

  const handleVoiceModeMouseLeave = () => {
    if (voiceModeTooltipTimer.current) window.clearTimeout(voiceModeTooltipTimer.current)
    setShowVoiceModeTooltip(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const hasQuery = query.trim().length > 0

  return (
    <div className="w-full">
      <div
        className={`
          sticky-search-bar-container
          relative
          flex
          items-center
          bg-[#1E1E1E]
          rounded-xl
          transition-all duration-200 ease-out
          
          ${isFocused
            ? "shadow-[0_0_0_1px_#A855F7,0_0_0_4px_rgba(168,85,247,0.12),0_4px_12px_rgba(0,0,0,0.4)]"
            : "shadow-[0_2px_8px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.5)] border border-white/[0.08]"}
          
          ${!isFocused && !isLoading && "hover:bg-[#222222] hover:border-white/[0.12]"}
        `}
        style={{
          height: '64px',
          minHeight: '64px'
        }}
      >
        <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={hasResults ? "Ask a follow-up question..." : "Ask anything..."}
          disabled={isLoading}
          aria-label="Enter your research question"
          className="
            flex-1
            h-full
            pl-5 pr-36 py-0
            bg-transparent 
            border-0 
            focus:ring-0 
            focus:outline-none 
            placeholder:text-[#666666]
            text-[#E5E5E5]
            disabled:opacity-50
          "
          style={{
            fontSize: '16px',
            lineHeight: '1.5',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale'
          }}
        />

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={handleDictate}
              onMouseEnter={handleMicMouseEnter}
              onMouseLeave={handleMicMouseLeave}
              disabled={isLoading}
              style={{ width: '40px', height: '40px' }}
              className={`
                rounded-lg flex items-center justify-center
                transition-all duration-200
                ${isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-[#2A2A2A] hover:bg-[#333333] text-neutral-400 hover:text-neutral-200"}
                ${isLoading ? "opacity-50 cursor-not-allowed" : "active:scale-95"}
              `}
              aria-label={isListening ? "Stop dictation" : "Start dictation"}
            >
              <Mic className="w-5 h-5" strokeWidth={2.5} />
            </button>

            {showMicTooltip && !isListening && !isLoading && (
              <div className="absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 px-3.5 py-2 bg-black/95 text-white text-[13px] font-medium rounded-lg whitespace-nowrap pointer-events-none shadow-[0_4px_16px_rgba(0,0,0,0.5)] z-[10000] animate-in fade-in duration-150">
                Dictate
                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-black/95"></div>
              </div>
            )}
          </div>

          {onVoiceModeToggle && (
            <div className="relative">
              <button
                type="button"
                onClick={onVoiceModeToggle}
                onMouseEnter={handleVoiceModeMouseEnter}
                onMouseLeave={handleVoiceModeMouseLeave}
                disabled={isLoading}
                style={{ width: '40px', height: '40px' }}
                className={`
                  rounded-lg flex items-center justify-center
                  transition-all duration-200
                  bg-[#2A2A2A] hover:bg-[#333333] text-neutral-400 hover:text-neutral-200
                  ${isLoading ? "opacity-50 cursor-not-allowed" : "active:scale-95"}
                `}
                aria-label="Enter voice mode"
              >
                <AudioWaveform className="w-5 h-5" strokeWidth={2.5} />
              </button>

              {showVoiceModeTooltip && !isLoading && (
                <div className="absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 px-3.5 py-2 bg-black/95 text-white text-[13px] font-medium rounded-lg whitespace-nowrap pointer-events-none shadow-[0_4px_16px_rgba(0,0,0,0.5)] z-[10000] animate-in fade-in duration-150">
                  Use voice mode
                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-black/95"></div>
                </div>
              )}
            </div>
          )}

          <button
            type={isLoading ? "button" : "submit"}
            onClick={isLoading ? handleStop : handleSubmit}
            disabled={!hasQuery && !isLoading}
            aria-label={isLoading ? "Stop generating" : "Submit research query"}
            style={{ width: '40px', height: '40px' }}
            className={`
              rounded-lg
              flex items-center justify-center
              transition-all duration-200 ease-out
              shadow-sm

              ${isLoading
                ? "bg-[#2A2A2A] hover:bg-[#333333] text-neutral-300 active:scale-95"
                : hasQuery
                  ? "bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white shadow-purple-500/20 hover:scale-[1.02] active:scale-95"
                  : "bg-[#2A2A2A] text-[#666666] cursor-not-allowed opacity-60"}
            `}
          >
            {isLoading ? (
              <Square className="h-4 w-4 fill-current" strokeWidth={2.5} />
            ) : (
              <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      {isListening && (
        <div className="mt-2 text-center animate-in fade-in duration-200">
          <span className="inline-flex items-center gap-2 px-3 py-1 bg-red-500/20 text-red-400 text-xs rounded-full">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            Listening...
          </span>
        </div>
      )}
    </div>
  )
}