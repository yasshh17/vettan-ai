"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import Sidebar from "@/components/layout/sidebar"
import { VoiceMode } from "@/components/research/voice-mode"
import { AudioPlayer } from "@/components/research/audio-player"
import { StickySearchBar } from "@/components/research/sticky-search-bar"
import { CollapsibleSources } from "@/components/research/collapsible-sources"
import { StatsPanel } from "@/components/research/stats-panel"
import { ActiveChatHeader } from "@/components/research/active-chat-header"
import { ChevronUp } from "lucide-react"
import axios from "axios"
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mainContainerRef = useRef<HTMLDivElement>(null)

  const hasResults = messages.length > 0

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
      if (hasResults) {
        mainContainerRef.current.style.overflow = "auto"
      } else {
        mainContainerRef.current.style.overflow = "hidden"
      }
    }
  }, [hasResults])

  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
    }
  }, [messages.length])

  useEffect(() => {
    const handleScroll = () => {
      if (mainContainerRef.current) {
        const { scrollTop } = mainContainerRef.current
        setShowScrollTop(scrollTop > 500)
      }
    }
    const container = mainContainerRef.current
    if (container) {
      container.addEventListener("scroll", handleScroll)
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

      axios
        .get(`${API_URL}/api/history/${sessionId}`)
        .then((response) => {
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

  const handleResultsUpdate = (newResult: ResearchResult) => {
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
          ${hasResults ? "overflow-y-auto pb-32" : "overflow-hidden pb-0"}
        `}
      >
        {/* HERO SECTION - Only show when NO messages */}
        {!hasResults && (
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
        {hasResults && (
          <div className="max-w-5xl mx-auto px-8 pt-8">
            <ActiveChatHeader title={activeQuery} isVisible={hasResults} />

            {isLoading && (
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
                <p className="text-neutral-500 text-sm">Analyzing sources and generating report...</p>
              </div>
            )}

            {error && (
              <Card className="border-red-900 bg-red-950/30 mb-8 max-w-3xl mx-auto">
                <CardContent className="p-4">
                  <p className="text-red-400">⚠️ {error}</p>
                </CardContent>
              </Card>
            )}

            {!isLoading && (
              <div className="pb-8 space-y-8">
                {messages.map((message, index) => {
                  const isLastAssistant = message.role === "assistant" && index === messages.length - 1
                  return (
                    <div key={message.id || index} className="max-w-4xl mx-auto">
                      {message.role === "user" ? (
                        <div className="mb-6 flex justify-end">
                          <div className="max-w-[85%] bg-gradient-to-br from-purple-500/15 to-indigo-500/10 border border-purple-500/25 rounded-2xl px-6 py-4 shadow-lg">
                            <p className="text-neutral-50 text-[15px] leading-relaxed font-medium">
                              {message.content}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-10">
                          <Card className="shadow-2xl border-neutral-800 bg-neutral-900/95">
                            <CardContent className="pt-7 pb-6 px-7">
                              <div className="prose prose-invert max-w-none 
                                prose-p:text-neutral-300 prose-p:leading-relaxed 
                                prose-headings:text-neutral-50 prose-headings:font-semibold 
                                prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:text-indigo-300
                                prose-strong:text-neutral-100 prose-strong:font-bold
                                prose-ul:text-neutral-300 prose-ol:text-neutral-300
                                prose-li:marker:text-neutral-400
                                prose-code:text-indigo-300 prose-code:bg-neutral-800/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                                prose-pre:bg-neutral-900/50 prose-pre:border prose-pre:border-neutral-800
                                prose-blockquote:border-l-indigo-500 prose-blockquote:text-neutral-400">
                                <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                                  {message.content}
                                </ReactMarkdown>
                              </div>

                              {message.citations && message.citations.length > 0 && (
                                <div className="mt-7 pt-6 border-t border-neutral-800/60">
                                  <CollapsibleSources sources={message.citations} />
                                </div>
                              )}
                            </CardContent>
                          </Card>

                          {isLastAssistant && (
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
                      )}
                      {index < messages.length - 1 && message.role === "assistant" && (
                        <div className="my-14 h-px bg-gradient-to-r from-transparent via-neutral-800/30 to-transparent" />
                      )}
                    </div>
                  )
                })}
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

      {hasResults && (
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
            />
          </div>
        </div>
      )}
    </div>
  )
}