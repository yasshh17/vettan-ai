"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowUp, Loader2, Mic, AudioWaveform } from "lucide-react"
import axios from "axios"

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
}

export function StickySearchBar({
  onResultsUpdate,
  isLoading,
  setIsLoading,
  hasResults,
  onVoiceModeToggle,
  currentSessionId
}: StickySearchBarProps) {
  const [query, setQuery] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [showMicTooltip, setShowMicTooltip] = useState(false)
  const [showVoiceModeTooltip, setShowVoiceModeTooltip] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const micTooltipTimer = useRef<number | null>(null)
  const voiceModeTooltipTimer = useRef<number | null>(null)

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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim() || isLoading) return

    setIsLoading(true)
    try {
      const isFollowUp = currentSessionId && hasResults
      const payload = {
        query,
        max_iterations: 25,
        use_cache: true,
        ...(isFollowUp ? { session_id: currentSessionId, is_followup: true } : {})
      }

      const response = await axios.post(`${API_URL}/api/research`, payload)
      if (isFollowUp) response.data.session_id = currentSessionId
      onResultsUpdate(response.data)
      setQuery("")
      setTimeout(() => window.scrollTo({ top: 300, behavior: "smooth" }), 150)
    } catch (err) {
      console.error("Research failed:", err)
    } finally {
      setIsLoading(false)
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
            type="submit"
            onClick={handleSubmit}
            disabled={!hasQuery || isLoading}
            aria-label="Submit research query"
            style={{ width: '40px', height: '40px' }}
            className={`
              rounded-lg
              flex items-center justify-center
              transition-all duration-200 ease-out
              shadow-sm
              
              ${hasQuery && !isLoading
                ? "bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white shadow-purple-500/20 hover:scale-[1.02] active:scale-95"
                : "bg-[#2A2A2A] text-[#666666] cursor-not-allowed opacity-60"}
            `}
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.5} />
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