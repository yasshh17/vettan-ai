"use client"

import { useState, useEffect, useRef, useCallback, memo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import Sidebar from "@/components/layout/sidebar"
import { VoiceMode } from "@/components/research/voice-mode"
import { AudioPlayer } from "@/components/research/audio-player"
import { StickySearchBar } from "@/components/research/sticky-search-bar"
import { RefusalBanner } from "@/components/research/refusal-banner"
import { CollapsibleSources } from "@/components/research/collapsible-sources"
import { StatsPanel } from "@/components/research/stats-panel"
import { ActiveChatHeader } from "@/components/research/active-chat-header"
import { AnswerFeedback, type Rating } from "@/components/research/answer-feedback"
import { ChevronUp } from "lucide-react"
import ReactMarkdown from 'react-markdown'
import type { StreamEvent } from "@/lib/research-stream"
import { authGet, withAuthRedirect } from "@/lib/auth-fetch"
import {
  bindDraftTo,
  claimPendingQuestion,
  clearPendingQuestion,
  readPendingQuestion,
  type PendingQuestion,
} from "@/lib/pending-question"
import { createClient } from "@/lib/supabase/client"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

/** Re-render interval for the streaming answer; tokens arrive much faster. */
const STREAM_FLUSH_MS = 80

interface Citation {
  domain: string
  url: string
}

interface Message {
  id: string
  // A streamed answer keeps its local id; this is the id it was saved under.
  serverId?: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  metadata?: any
  created_at: string
  // Set when a stream ended (error or abort) after some text had already arrived: the content
  // is real but cut short, so it must not be presented the same as a finished report.
  incomplete?: boolean
  incompleteReason?: string
}

interface ResearchResult {
  output: string
  citations: Citation[]
  metadata: any
  session_id: string
  messages: Message[]
}

/** Hide half-written markdown so it doesn't flash as raw syntax while streaming. */
function trimIncompleteMarkdown(text: string): string {
  let out = text

  const lastLinkStart = out.lastIndexOf("[")
  if (lastLinkStart !== -1 && !/\]\([^)]*\)/.test(out.slice(lastLinkStart))) {
    out = out.slice(0, lastLinkStart)
  }

  if ((out.match(/\*\*/g) || []).length % 2 === 1) {
    out = out.slice(0, out.lastIndexOf("**"))
  }

  return out
}

const PROSE_CLASSES = `prose prose-invert max-w-none
  !text-gray-100
  [&_p]:!text-gray-200 [&_p]:leading-relaxed [&_p]:text-[1.05rem]
  [&_h1]:!text-white [&_h1]:font-bold [&_h1]:text-3xl
  [&_h2]:!text-white [&_h2]:font-bold [&_h2]:text-2xl
  [&_h3]:!text-white [&_h3]:font-bold [&_h3]:text-xl
  [&_a]:!text-indigo-400 [&_a]:no-underline hover:[&_a]:!text-indigo-300 hover:[&_a]:underline
  [&_strong]:!text-white [&_strong]:font-bold
  [&_ul]:!text-gray-200 [&_ol]:!text-gray-200
  [&_li]:!text-gray-200 [&_li]:marker:!text-gray-500
  [&_code]:!text-indigo-300 [&_code]:bg-neutral-800/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:before:content-none [&_code]:after:content-none
  [&_pre]:bg-neutral-900 [&_pre]:border [&_pre]:border-neutral-800 [&_pre]:p-4 [&_pre]:rounded-xl
  [&_blockquote]:border-l-4 [&_blockquote]:!border-indigo-500 [&_blockquote]:!text-gray-300 [&_blockquote]:pl-4 [&_blockquote]:italic
  `

/** Memoized: the streaming row re-renders ~12x a second and shouldn't re-parse the others. */
const MessageRow = memo(function MessageRow({
  message,
  isLastAssistant,
  showDivider,
  isStreaming,
  sessionId,
  rating,
  isFollowup
}: {
  message: Message
  isLastAssistant: boolean
  showDivider: boolean
  isStreaming: boolean
  sessionId: string | null
  rating: Rating | null
  isFollowup: boolean
}) {
  if (message.role === "user") {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex justify-end">
          <div className="max-w-[85%] bg-gradient-to-br from-purple-500/15 to-indigo-500/10 border border-purple-500/25 rounded-2xl px-6 py-4 shadow-lg">
            <p className="text-neutral-50 text-[15px] leading-relaxed font-medium">
              {message.content}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const body = isStreaming ? trimIncompleteMarkdown(message.content) : message.content

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <Card className="shadow-2xl border-neutral-800 bg-neutral-900/95">
          <CardContent className="pt-7 pb-6 px-7">
            <div className={PROSE_CLASSES}>
              <ReactMarkdown>
                {body}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-[2px] h-[1.1em] ml-0.5 -mb-[0.15em] bg-indigo-400 animate-blink" />
              )}
            </div>

            {message.citations && message.citations.length > 0 && (
              <div className="mt-7 pt-6 border-t border-neutral-800/60">
                <CollapsibleSources sources={message.citations} />
              </div>
            )}

            {message.incomplete && (
              <p className="mt-4 pt-3 border-t border-amber-900/30 text-sm text-amber-400/90">
                ⚠ This answer is incomplete{message.incompleteReason ? `: ${message.incompleteReason}` : "."}
              </p>
            )}
          </CardContent>
        </Card>

        {!isStreaming && !message.incomplete && (
          <div className="mt-2 flex justify-end">
            <AnswerFeedback
              sessionId={sessionId}
              messageId={message.serverId ?? message.id}
              initialRating={rating}
              isFollowup={isFollowup}
            />
          </div>
        )}

        {isLastAssistant && !isStreaming && !message.incomplete && (
          <div className="mt-5 space-y-4">
            <AudioPlayer text={message.content} />
            {message.metadata && !message.metadata.error && (
              <StatsPanel
                metadata={message.metadata}
                citationsCount={message.citations?.length || 0}
              />
            )}
          </div>
        )}
      </div>
      {showDivider && (
        <div className="my-14 h-px bg-gradient-to-r from-transparent via-neutral-800/30 to-transparent" />
      )}
    </div>
  )
})

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // True only while a saved session's messages are being fetched (a plain GET, no research
  // running), so the "Researching..." panel can tell the two apart instead of showing for both.
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The answer is shown but wasn't saved: a warning, not an error.
  const [notice, setNotice] = useState<string | null>(null)
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [showScrollTop, setShowScrollTop] = useState(false)

  const [isStreaming, setIsStreaming] = useState(false)
  const [streamStage, setStreamStage] = useState<{ subQueries: string[]; sources: Citation[] }>({
    subQueries: [],
    sources: []
  })
  const [streamingId, setStreamingId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const refusalRef = useRef<HTMLDivElement>(null)
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const streamBufferRef = useRef<{ id: string; text: string } | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const isAtBottomRef = useRef(true)
  const scrollRafRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  // Owned here because the search bar unmounts mid-stream.
  const streamAbortRef = useRef<AbortController | null>(null)
  // Same reason: a rejected first query remounts the search bar.
  const pendingQueryRef = useRef<string | null>(null)
  // A refused query, re-delivered to whichever search bar is mounted when the refusal arrives.
  const [restoredQuery, setRestoredQuery] = useState<{
    text: string
    id: number
    pendingId?: string
    ifEmpty?: boolean
  } | null>(null)
  const restoreQuery = useCallback(
    (text: string) => setRestoredQuery({ text, id: Date.now() }),
    []
  )
  // A question kept on this device from the landing page. It's only pre-filled, never sent:
  // the visitor starts the research themselves.
  const [handoff, setHandoff] = useState<{
    entry: PendingQuestion
    outcome: "pending" | "applied" | "declined"
  } | null>(null)
  // Set when a saved conversation is opened or a research run starts; cleared by New chat.
  const conversationStartedRef = useRef(false)
  // The kept question shown in this view. It's forgotten only once its research has an answer,
  // so leaving before that (New chat, a past conversation, closing the tab) doesn't lose it.
  const handoffIdRef = useRef<string | null>(null)
  const handoffTextRef = useRef("")
  // True while a run of exactly that question is in flight.
  const handoffRunRef = useRef(false)
  // Bumped on "New chat" so the hero search bar remounts empty.
  const [searchBarKey, setSearchBarKey] = useState(0)

  const hasResults = messages.length > 0
  const firstAnswerIndex = messages.findIndex((m) => m.role === "assistant")

  // Pre-fills an empty new-research view; the search bar won't overwrite a draft and confirms
  // when it shows the text.
  const offerPendingQuestion = useCallback(async () => {
    const found = readPendingQuestion()
    if (!found) return
    let userId: string | null = null
    try {
      userId = (await createClient().auth.getSession()).data.session?.user?.id ?? null
    } catch {}
    if (!userId || conversationStartedRef.current) return
    // Someone else's question (their session ended here without signing out): never shown.
    if (found.owner && found.owner !== userId) {
      clearPendingQuestion(found.id)
      return
    }
    // A question typed while signed out becomes this user's, so no later account sees it.
    const entry = found.owner ? found : claimPendingQuestion(found.id, userId)
    if (!entry) return
    // This tab's landing draft of the same text goes with it.
    bindDraftTo(entry)
    handoffIdRef.current = entry.id
    handoffTextRef.current = entry.text
    setHandoff({ entry, outcome: "pending" })
    setRestoredQuery({ text: entry.text, id: Date.now(), pendingId: entry.id, ifEmpty: true })
  }, [])

  // Once mounted, nothing else loads a conversation on its own, so an idle page can take it.
  useEffect(() => {
    if (!conversationStartedRef.current) offerPendingQuestion()
  }, [offerPendingQuestion])

  const handleRestoredQueryApplied = useCallback(
    (pendingId: string, outcome: "applied" | "declined") => {
      // A conversation opened in the meantime: keep the question for later, show nothing.
      if (conversationStartedRef.current) {
        setHandoff(null)
        return
      }
      setHandoff((h) => (h && h.entry.id === pendingId ? { ...h, outcome } : h))
    },
    []
  )

  const forgetHandoff = () => {
    if (handoffIdRef.current) clearPendingQuestion(handoffIdRef.current)
    handoffIdRef.current = null
    handoffRunRef.current = false
    setHandoff(null)
  }

  useEffect(() => {
    setRatings({})
    if (!currentSessionId) return
    let cancelled = false
    authGet<{ ratings: Record<string, Rating> }>(
      `${API_URL}/api/feedback?session_id=${encodeURIComponent(currentSessionId)}`
    )
      .then((data) => {
        if (!cancelled) setRatings(data.ratings ?? {})
      })
      // Unsaved or brand-new sessions have no votes to show.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [currentSessionId])
  const hasStreamedText = Boolean(
    streamingId && messages.find((m) => m.id === streamingId)?.content
  )

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarExpanded")
      return saved !== null ? JSON.parse(saved) : true
    }
    return true
  })

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebarExpanded", JSON.stringify(isSidebarExpanded))
    }
  }, [isSidebarExpanded])

  useEffect(() => {
    if (mainContainerRef.current) {
      if (hasResults || isLoading) {
        mainContainerRef.current.style.overflow = "auto"
      } else {
        mainContainerRef.current.style.overflow = "hidden"
      }
    }
  }, [hasResults, isLoading])

  // Auto-scroll only while the reader is at the bottom.
  useEffect(() => {
    if (messages.length === 0 || !isAtBottomRef.current) return
    if (scrollRafRef.current !== null) return

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      messagesEndRef.current?.scrollIntoView({
        behavior: isStreamingRef.current ? "auto" : "smooth"
      })
    })
  }, [messages])

  // The input box covers the bottom of the list, so center it.
  useEffect(() => {
    if (!refusal) return
    const frame = requestAnimationFrame(() =>
      refusalRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    )
    return () => cancelAnimationFrame(frame)
  }, [refusal])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      if (mainContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = mainContainerRef.current
        setShowScrollTop(scrollTop > 500)
        isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 80
      }
    }
    const container = mainContainerRef.current
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true })
      return () => container.removeEventListener("scroll", handleScroll)
    }
  }, [])

  const scrollToTop = () => {
    mainContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleSelectQuery = (query: string, sessionId?: string) => {
    if (sessionId) {
      conversationStartedRef.current = true
      // Still saved for later; just not part of this conversation.
      handoffIdRef.current = null
      handoffRunRef.current = false
    }
    setHandoff(null)
    setActiveQuery(query)
    // A newly mounted bar would otherwise pick up an earlier refused query.
    setRestoredQuery(null)

    if (sessionId) {
      // Switching to a different chat: drop any query kept for the old one (e.g. a failed question
      // put back for retry) and remount the bar, so it can't be sent as a follow-up here.
      // Reselecting the open chat keeps the draft.
      if (sessionId !== currentSessionId) {
        pendingQueryRef.current = null
        setSearchBarKey((k) => k + 1)
      }
      setIsLoading(true)
      setIsLoadingSession(true)
      setError(null)
      setRefusal(null)
      setCurrentSessionId(sessionId)

      withAuthRedirect(() => authGet<any>(`${API_URL}/api/history/${sessionId}`))
        .then((data) => {
          const response = { data }
          if (response.data.messages?.length) {
            setMessages(response.data.messages)
          } else {
            setMessages([
              {
                id: "1",
                role: "user",
                content: query,
                created_at: new Date().toISOString()
              },
              {
                id: "2",
                role: "assistant",
                content: response.data.output,
                citations: response.data.citations,
                metadata: response.data.metadata,
                created_at: new Date().toISOString()
              }
            ])
          }
        })
        .catch((err) => {
          console.error("Failed to load session:", err)
          setError("Failed to load conversation")
        })
        .finally(() => {
          setIsLoading(false)
          setIsLoadingSession(false)
        })
    } else {
      setMessages([])
      setError(null)
      setRefusal(null)
      setCurrentSessionId(null)
      pendingQueryRef.current = null
      setSearchBarKey((k) => k + 1)
      // A fresh view: a question still kept from the homepage is offered again.
      conversationStartedRef.current = false
      offerPendingQuestion()
      setTimeout(() => mainContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 0)
    }
  }

  const applyBuffer = useCallback(() => {
    const buffered = streamBufferRef.current
    if (!buffered) return
    setMessages((prev) =>
      prev.map((m) => (m.id === buffered.id ? { ...m, content: buffered.text } : m))
    )
  }, [])

  const flushStream = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    applyBuffer()
  }, [applyBuffer])

  const endStream = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    streamBufferRef.current = null
    isStreamingRef.current = false
    setIsStreaming(false)
    setStreamingId(null)
    setStreamStage({ subQueries: [], sources: [] })
  }, [])

  /** Show the question and an empty answer. Every event calls it too, so tokens always have a target. */
  const ensureStreamTarget = useCallback(
    (context: { query: string; isFollowUp: boolean }) => {
      conversationStartedRef.current = true
      if (streamBufferRef.current) return
      // An edited or different question leaves the kept one saved.
      handoffRunRef.current =
        Boolean(handoffIdRef.current) && !context.isFollowUp && context.query.trim() === handoffTextRef.current

      const stamp = Date.now()
      const assistantId = `stream-a-${stamp}`
      const userMsg: Message = {
        id: `stream-u-${stamp}`,
        role: "user",
        content: context.query,
        created_at: new Date().toISOString()
      }
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString()
      }

      streamBufferRef.current = { id: assistantId, text: "" }
      isStreamingRef.current = true
      isAtBottomRef.current = true
      setIsStreaming(true)
      setStreamingId(assistantId)
      setStreamStage({ subQueries: [], sources: [] })
      setError(null)
      setRefusal(null)
      setNotice(null)
      setActiveQuery(context.query)
      setMessages((prev) =>
        context.isFollowUp ? [...prev, userMsg, assistantMsg] : [userMsg, assistantMsg]
      )
    },
    []
  )

  const handleStreamEvent = useCallback(
    (event: StreamEvent, context: { query: string; isFollowUp: boolean }) => {
      switch (event.type) {
        case "submitted": {
          ensureStreamTarget(context)
          break
        }

        case "stage": {
          ensureStreamTarget(context)
          setStreamStage((s) => ({ ...s, subQueries: event.sub_queries || [] }))
          break
        }

        case "sources": {
          ensureStreamTarget(context)
          const citations = (event.citations || []) as Citation[]
          const id = streamBufferRef.current?.id
          setStreamStage((s) => ({ ...s, sources: citations }))
          if (id) {
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, citations } : m)))
          }
          break
        }

        case "token": {
          ensureStreamTarget(context)
          const buffered = streamBufferRef.current
          if (!buffered) {
            // Unreachable; logged because silently dropped tokens once hid a regression.
            console.warn("Dropped a streamed token: no target message", event)
            break
          }
          buffered.text += event.text
          if (flushTimerRef.current === null) {
            flushTimerRef.current = window.setTimeout(() => {
              flushTimerRef.current = null
              applyBuffer()
            }, STREAM_FLUSH_MS)
          }
          break
        }

        case "done": {
          const buffered = streamBufferRef.current
          flushStream()
          if (buffered) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === buffered.id
                  ? {
                      ...m,
                      serverId: event.assistant_message_id,
                      content: buffered.text || m.content,
                      citations: (event.citations as Citation[]) ?? m.citations,
                      metadata: event.metadata
                    }
                  : m
              )
            )
          }
          endStream()
          break
        }

        case "error": {
          const buffered = streamBufferRef.current
          flushStream()
          if (buffered) {
            if (!buffered.text) {
              setMessages((prev) => prev.filter((m) => m.id !== buffered.id))
            } else {
              // Real, partial text: keep it, but mark it so it's never shown as a finished answer.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === buffered.id ? { ...m, incomplete: true, incompleteReason: event.message } : m
                )
              )
            }
          }
          setError(event.message)
          endStream()
          break
        }

        case "blocked": {
          // Unlike "error", drop the answer even if some of it already streamed.
          const buffered = streamBufferRef.current
          flushStream()
          if (buffered) {
            setMessages((prev) => prev.filter((m) => m.id !== buffered.id))
          }
          setRefusal(event.message)
          endStream()
          break
        }

        case "not_saved": {
          setNotice(
            "This answer finished but wasn't saved to your history, so it won't be here after a reload. " +
            "That usually means you already have a saved session for this exact query."
          )
          break
        }

        case "aborted": {
          const buffered = streamBufferRef.current
          flushStream()
          if (buffered && !buffered.text) {
            setMessages((prev) => prev.filter((m) => m.id !== buffered.id))
          } else if (buffered) {
            setMessages((prev) =>
              prev.map((m) => (m.id === buffered.id ? { ...m, incomplete: true } : m))
            )
            setError("Stopped. This partial answer was not saved.")
          }
          endStream()
          break
        }
      }
    },
    [applyBuffer, flushStream, endStream, ensureStreamTarget]
  )

  const handleResultsUpdate = (newResult: ResearchResult & { streamed?: boolean }) => {
    // The kept question has an answer now (streamed or fallback), so it's done its job.
    if (handoffRunRef.current) forgetHandoff()
    if (newResult.streamed) {
      if (newResult.session_id) setCurrentSessionId(newResult.session_id)
      return
    }

    if (newResult.messages?.length) {
      setMessages(newResult.messages)
    } else {
      const input = document.querySelector('input[type="text"]') as HTMLInputElement | null
      const userQuery = input?.value || activeQuery || "Unknown"

      const fallback: Message[] = [
        {
          id: Date.now().toString(),
          role: "user",
          content: userQuery,
          created_at: new Date().toISOString()
        },
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: newResult.output,
          citations: newResult.citations,
          metadata: newResult.metadata,
          created_at: new Date().toISOString()
        }
      ]

      if (currentSessionId && newResult.session_id === currentSessionId) {
        setMessages((prev) => [...prev, ...fallback])
      } else {
        setMessages(fallback)
      }
    }

    setError(null)
    setRefusal(null)
    if (newResult.session_id) setCurrentSessionId(newResult.session_id)

    const input = document.querySelector('input[type="text"]') as HTMLInputElement | null
    if (input?.value) setActiveQuery(input.value)
  }

  return (
    <div className="flex h-screen bg-neutral-950 overflow-hidden">
      <VoiceMode isOpen={isVoiceModeOpen} onClose={() => setIsVoiceModeOpen(false)} />

      <Sidebar
        onSelectQuery={handleSelectQuery}
        isExpanded={isSidebarExpanded}
        setIsExpanded={setIsSidebarExpanded}
      />

      <main
        ref={mainContainerRef}
        className={`
          main-content
          flex-1 relative
          transition-all duration-300 ease-out
          ${isSidebarExpanded ? "lg:ml-64" : "lg:ml-16"}
          ${hasResults || isLoading ? "overflow-y-auto pb-32" : "overflow-hidden pb-0"}
        `}
      >
        {/* Hidden while loading so a submit or history click always shows feedback. */}
        {!hasResults && !isLoading && (
          <div className="min-h-screen flex flex-col justify-center items-center px-4">
            <header className="text-center mb-12">
              <h1 className="text-6xl md:text-7xl font-bold mb-5 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Vettan
              </h1>
              <p className="text-xl md:text-2xl text-neutral-400">
                Think deeper. Discover faster.
              </p>
            </header>

            <div className="w-full max-w-[850px] space-y-10">
              {handoff && handoff.outcome !== "pending" && (
                <div
                  role="status"
                  className="flex items-start justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3"
                >
                  {handoff.outcome === "applied" ? (
                    <div className="min-w-0 text-sm text-neutral-300">
                      <p>We kept your question from the homepage. Press Enter or Submit research query to begin.</p>
                      <p className="mt-1 text-neutral-500">
                        It stays saved on this device until it has an answer.{" "}
                        <button
                          type="button"
                          onClick={forgetHandoff}
                          className="font-medium text-indigo-300 hover:text-indigo-200"
                        >
                          Forget it
                        </button>
                      </p>
                    </div>
                  ) : (
                    <div className="min-w-0 text-sm text-neutral-300">
                      <p>You have a question from the homepage:</p>
                      <p className="mt-1 break-words text-neutral-100">{handoff.entry.text}</p>
                      <button
                        type="button"
                        onClick={() =>
                          setRestoredQuery({ text: handoff.entry.text, id: Date.now(), pendingId: handoff.entry.id })
                        }
                        className="mt-2 font-medium text-indigo-300 hover:text-indigo-200"
                      >
                        Use question from homepage
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setHandoff(null)}
                    className="shrink-0 text-sm text-neutral-500 hover:text-neutral-300"
                    aria-label="Dismiss"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              <StickySearchBar
                key={searchBarKey}
                onResultsUpdate={handleResultsUpdate}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                hasResults={hasResults}
                onVoiceModeToggle={() => setIsVoiceModeOpen(true)}
                currentSessionId={currentSessionId}
                onStreamEvent={handleStreamEvent}
                abortRef={streamAbortRef}
                pendingQueryRef={pendingQueryRef}
                restoredQuery={restoredQuery}
                onRestoreQuery={restoreQuery}
                onRestoredQueryApplied={handleRestoredQueryApplied}
              />

              <div className="space-y-3 animate-in fade-in duration-700 delay-500">
                <p className="text-sm text-neutral-500 text-center">Try asking:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    "Best AI browsers right now",
                    "How do RAG systems work?",
                    "AI investment trends to watch",
                    "Cancer vaccine developments"
                  ].map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setActiveQuery(prompt)
                        const input = document.querySelector('input[type="text"]') as HTMLInputElement | null
                        if (input) {
                          const setter = Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype,
                            "value"
                          )?.set
                          setter?.call(input, prompt)
                          input.dispatchEvent(new Event("input", { bubbles: true }))
                          input.focus()
                        }
                      }}
                      className="text-left px-5 py-3.5 text-sm text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-xl hover:border-neutral-700 hover:bg-neutral-800 hover:shadow-sm transition-all duration-200 active:scale-[0.98]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {(hasResults || isLoading) && (
          <div className="max-w-5xl mx-auto px-8 pt-8">
            <ActiveChatHeader title={activeQuery} isVisible={hasResults} />

            {isLoading && !hasStreamedText && !isLoadingSession && (
              <div className="text-center py-24 animate-in fade-in duration-300">
                <div className="relative inline-block mb-8">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 opacity-20 blur-xl animate-pulse" />
                  <div
                    className="relative w-16 h-16 rounded-full bg-gradient-to-r from-purple-500 via-indigo-500 to-purple-500"
                    style={{ animation: "spin 2s linear infinite" }}
                  >
                    <div className="absolute inset-[3px] rounded-full bg-neutral-950" />
                  </div>
                </div>
                <h2 className="text-2xl font-medium mb-3">
                  {activeQuery ? (
                    <>
                      <span className="text-neutral-200">Researching </span>
                      <span className="bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
                        {activeQuery}
                      </span>
                    </>
                  ) : (
                    <span className="bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
                      Processing
                    </span>
                  )}
                </h2>
                <p className="text-neutral-500 text-sm">
                  {streamStage.sources.length > 0
                    ? `Reading ${streamStage.sources.length} sources...`
                    : streamStage.subQueries.length > 0
                      ? "Searching..."
                      : "Analyzing sources and generating report..."}
                </p>

                {streamStage.subQueries.length > 0 && (
                  <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
                    {streamStage.subQueries.map((sub, i) => (
                      <span
                        key={sub}
                        className="px-3 py-1.5 text-[13px] text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-full animate-in fade-in slide-in-from-bottom-4 duration-300"
                        style={{ animationDelay: `${i * 60}ms` }}
                      >
                        {sub}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <Card className="border-red-900 bg-red-950/30 mb-8 max-w-3xl mx-auto">
                <CardContent className="p-4">
                  <p className="text-red-400">⚠️ {error}</p>
                </CardContent>
              </Card>
            )}

            {notice && (
              <Card className="border-amber-900/70 bg-amber-950/20 mb-8 max-w-3xl mx-auto">
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <p className="text-amber-300/90 text-sm">{notice}</p>
                  <button
                    onClick={() => setNotice(null)}
                    className="text-amber-400/60 hover:text-amber-300 text-sm shrink-0"
                    aria-label="Dismiss notice"
                  >
                    Dismiss
                  </button>
                </CardContent>
              </Card>
            )}

            {/* Stays mounted while streaming; hidden only while a saved session loads. */}
            {!(isLoading && !isStreaming) && (
              <div className="pb-8 space-y-8">
                {messages.map((message, index) => (
                  <MessageRow
                    key={message.id || index}
                    message={message}
                    isLastAssistant={message.role === "assistant" && index === messages.length - 1}
                    showDivider={index < messages.length - 1 && message.role === "assistant"}
                    isStreaming={message.id === streamingId}
                    sessionId={currentSessionId}
                    rating={ratings[message.serverId ?? message.id] ?? null}
                    isFollowup={index > firstAnswerIndex}
                  />
                ))}
                {refusal && (
                  <div ref={refusalRef}>
                    <RefusalBanner message={refusal} />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        )}

        {showScrollTop && hasResults && (
          <button
            onClick={scrollToTop}
            className="fixed bottom-36 right-10 z-20 w-14 h-14 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-2xl shadow-purple-500/25 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95"
            aria-label="Scroll to top"
          >
            <ChevronUp className="w-6 h-6" strokeWidth={2.5} />
          </button>
        )}
      </main>

      {(hasResults || isLoading) && (
        <div
          className={`
            fixed bottom-0 left-0 right-0 z-30
            pb-6
            transition-all duration-300 ease-out
            ${isSidebarExpanded ? "lg:left-64" : "lg:left-16"}
          `}
        >
          <div className="max-w-[800px] mx-auto px-4">
            <StickySearchBar
              key={searchBarKey}
              onResultsUpdate={handleResultsUpdate}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              hasResults={hasResults}
              onVoiceModeToggle={() => setIsVoiceModeOpen(true)}
              currentSessionId={currentSessionId}
              onStreamEvent={handleStreamEvent}
              abortRef={streamAbortRef}
              pendingQueryRef={pendingQueryRef}
              restoredQuery={restoredQuery}
              onRestoreQuery={restoreQuery}
              onRestoredQueryApplied={handleRestoredQueryApplied}
            />
          </div>
        </div>
      )}
    </div>
  )
}