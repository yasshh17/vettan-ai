"use client"

import { useState, useEffect, useRef, useCallback, memo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import Sidebar from "@/components/layout/sidebar"
import { VoiceMode } from "@/components/research/voice-mode"
import { AudioPlayer } from "@/components/research/audio-player"
import { StickySearchBar } from "@/components/research/sticky-search-bar"
import { CollapsibleSources } from "@/components/research/collapsible-sources"
import { StatsPanel } from "@/components/research/stats-panel"
import { ActiveChatHeader } from "@/components/research/active-chat-header"
import { ChevronUp } from "lucide-react"
import ReactMarkdown from 'react-markdown'
import type { StreamEvent } from "@/lib/research-stream"
import { authGet, withAuthRedirect } from "@/lib/auth-fetch"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

/** How often the growing answer is re-rendered. Tokens arrive far faster than this. */
const STREAM_FLUSH_MS = 80

interface Citation {
  domain: string
  url: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  metadata?: any
  created_at: string
}

interface ResearchResult {
  output: string
  citations: Citation[]
  metadata: any
  session_id: string
  messages: Message[]
}

/**
 * Hide markdown that is only half-written, so a link or bold marker doesn't
 * flash as raw syntax while the answer streams in.
 */
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

/**
 * One row of the conversation. Memoized because a streaming answer re-renders
 * its own row ~12x a second, and re-parsing every earlier message with it would
 * get slower as the thread grows.
 */
const MessageRow = memo(function MessageRow({
  message,
  isLastAssistant,
  showDivider,
  isStreaming
}: {
  message: Message
  isLastAssistant: boolean
  showDivider: boolean
  isStreaming: boolean
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
          </CardContent>
        </Card>

        {isLastAssistant && !isStreaming && (
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
  const [error, setError] = useState<string | null>(null)
  // Distinct from `error`: the answer is on screen and correct, it just did not
  // reach the user's history. Warning, not failure.
  const [notice, setNotice] = useState<string | null>(null)
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  // Streaming answer state
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamStage, setStreamStage] = useState<{ subQueries: string[]; sources: Citation[] }>({
    subQueries: [],
    sources: []
  })
  const [streamingId, setStreamingId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const streamBufferRef = useRef<{ id: string; text: string } | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const isAtBottomRef = useRef(true)
  const scrollRafRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  // Owned here, not in the search bar: that component unmounts mid-stream when
  // the hero gives way to the docked bar, which would strand the controller.
  const streamAbortRef = useRef<AbortController | null>(null)
  // Same reason, for the query text: a rejected first-ever query flips
  // isLoading true then back to false with no results yet, so the hero bar
  // unmounts and remounts as a fresh instance with empty local state. A plain
  // setQuery() call from the failing instance's stale closure would target a
  // component that's already gone. This ref survives the swap; the next
  // mounted instance (hero or docked, whichever it is) reads and clears it.
  const pendingQueryRef = useRef<string | null>(null)

  const hasResults = messages.length > 0
  // True once the streamed answer has actual text, i.e. the stage panel can go away
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

  // Follow the answer as it grows, but only while the reader is already at the
  // bottom — scrolling up to re-read must never be yanked back down.
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
    setActiveQuery(query)

    if (sessionId) {
      setIsLoading(true)
      setError(null)
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
        .finally(() => setIsLoading(false))
    } else {
      setMessages([])
      setError(null)
      setCurrentSessionId(null)
      setTimeout(() => mainContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 0)
    }
  }

  /** Write the buffered tokens into the streaming message. */
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

  /**
   * Put the question and an empty answer on screen and point the token buffer at
   * that answer. Called when a query is submitted, and again defensively by every
   * incoming event: if this has not run, a streamed answer has nowhere to go and
   * the page would appear frozen on the hero view.
   */
  const ensureStreamTarget = useCallback(
    (context: { query: string; isFollowUp: boolean }) => {
      if (streamBufferRef.current) return

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
          // Show the question and an empty answer straight away, then fill it in
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
            // Should be unreachable. Never fail silently here again: dropping
            // tokens is what made the streaming regression invisible.
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
          if (buffered && !buffered.text) {
            setMessages((prev) => prev.filter((m) => m.id !== buffered.id))
          }
          setError(event.message)
          endStream()
          break
        }

        case "not_saved": {
          // The answer is correct and on screen; only persistence failed. Say
          // so plainly rather than letting it disappear on the next reload.
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
          } else {
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
    // A streamed answer is already on screen; only the session needs updating.
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
        {/* HERO SECTION - only while there is nothing to show and nothing loading,
            so a submit or a history click always produces visible feedback */}
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
              <StickySearchBar
                onResultsUpdate={handleResultsUpdate}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                hasResults={hasResults}
                onVoiceModeToggle={() => setIsVoiceModeOpen(true)}
                currentSessionId={currentSessionId}
                onStreamEvent={handleStreamEvent}
                abortRef={streamAbortRef}
                pendingQueryRef={pendingQueryRef}
              />

              <div className="space-y-3 animate-in fade-in duration-700 delay-500">
                <p className="text-sm text-neutral-500 text-center">Try asking:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    "Best AI browsers in 2025",
                    "How do RAG systems work?",
                    "AI investment trends 2025",
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

        {/* CONVERSATION VIEW - No hero, content starts immediately */}
        {(hasResults || isLoading) && (
          <div className="max-w-5xl mx-auto px-8 pt-8">
            <ActiveChatHeader title={activeQuery} isVisible={hasResults} />

            {isLoading && !hasStreamedText && (
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

            {/* The list stays mounted while an answer streams; it is only hidden
                while a saved session is being loaded. */}
            {!(isLoading && !isStreaming) && (
              <div className="pb-8 space-y-8">
                {messages.map((message, index) => (
                  <MessageRow
                    key={message.id || index}
                    message={message}
                    isLastAssistant={message.role === "assistant" && index === messages.length - 1}
                    showDivider={index < messages.length - 1 && message.role === "assistant"}
                    isStreaming={message.id === streamingId}
                  />
                ))}
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
              onResultsUpdate={handleResultsUpdate}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              hasResults={hasResults}
              onVoiceModeToggle={() => setIsVoiceModeOpen(true)}
              currentSessionId={currentSessionId}
              onStreamEvent={handleStreamEvent}
              abortRef={streamAbortRef}
              pendingQueryRef={pendingQueryRef}
            />
          </div>
        </div>
      )}
    </div>
  )
}