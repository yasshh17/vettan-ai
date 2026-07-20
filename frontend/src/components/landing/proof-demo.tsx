"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const traceBadges = [
  "Searching sources",
  "Reading & extracting",
  "Cross-checking claims",
  "Synthesizing answer",
]

const answer = `2025 saw AI-enhanced browsers move from novelty to genuine utility, led by Opera AI, Brave Leo, and Perplexity's Comet — each integrating natural language commands like 'summarize this article' directly into the browsing experience. But the year also surfaced real security tradeoffs: a vulnerability dubbed 'CometJacking' affected Perplexity's Comet, allowing malicious links to instruct the AI to access and exfiltrate data from connected services like Gmail — a reminder that deeper AI integration expands the attack surface as much as it expands capability.`

const sources = ["[1] seraphicsecurity.com", "[2] layerxsecurity.com"]

export function ProofDemo() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [chipCount, setChipCount] = useState(0)
  const [typedCount, setTypedCount] = useState(0)
  const [playing, setPlaying] = useState(false)

  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([])
  const typeInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearAll = useCallback(() => {
    timeouts.current.forEach(clearTimeout)
    timeouts.current = []
    if (typeInterval.current) {
      clearInterval(typeInterval.current)
      typeInterval.current = null
    }
  }, [])

  const play = useCallback(() => {
    clearAll()
    setChipCount(0)
    setTypedCount(0)
    setPlaying(true)

    traceBadges.forEach((_, index) => {
      timeouts.current.push(
        setTimeout(() => setChipCount(index + 1), (index + 1) * 500)
      )
    })

    const typeStart = traceBadges.length * 500 + 300
    timeouts.current.push(
      setTimeout(() => {
        const step = Math.max(1, Math.ceil(answer.length / 70))
        typeInterval.current = setInterval(() => {
          setTypedCount((prev) => {
            const next = prev + step
            if (next >= answer.length) {
              if (typeInterval.current) {
                clearInterval(typeInterval.current)
                typeInterval.current = null
              }
              setPlaying(false)
              return answer.length
            }
            return next
          })
        }, 20)
      }, typeStart)
    )
  }, [clearAll])

  useEffect(() => {
    const node = sectionRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true)
            play()
            observer.disconnect()
          }
        })
      },
      { threshold: 0.3 }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [play])

  useEffect(() => clearAll, [clearAll])

  return (
    <div
      ref={sectionRef}
      id="proof"
      data-visible={visible}
      className="reveal relative z-10 mx-auto max-w-[820px] px-12 py-[110px]"
    >
      <h2 className="text-center text-[36px] font-bold tracking-[-0.01em] text-[#EDEDF2]">
        See it reason
      </h2>
      <p className="mx-auto mt-4 max-w-[540px] text-center text-[17px] leading-[1.55] text-[#A6A6B3]">
        One question, worked end to end — agent trace and cited answer.
      </p>

      <div className="mt-12 rounded-[16px] border border-[rgba(255,255,255,0.09)] bg-[rgba(255,255,255,0.02)] px-[30px] py-7">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[rgba(124,111,240,0.18)] font-[family-name:var(--font-geist-mono)] text-[13px] font-medium text-[#B6ACFF]">
            Q
          </span>
          <span className="flex-1 text-[17px] font-medium text-[#EDEDF2]">
            Best AI browsers in 2025
          </span>
          <button
            onClick={play}
            className="rounded-[8px] border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-[13px] font-medium text-[#9B9BA8] transition-colors hover:border-[rgba(255,255,255,0.25)] hover:text-[#EDEDF2]"
          >
            Replay ↻
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {traceBadges.map((badge, index) => (
            <span
              key={badge}
              className="animate-fadeup rounded-full border border-[rgba(124,111,240,0.28)] bg-[rgba(124,111,240,0.12)] px-3 py-1 font-[family-name:var(--font-geist-mono)] text-[12.5px] font-medium text-[#B6ACFF]"
              style={{ display: index < chipCount ? "inline-flex" : "none" }}
            >
              {badge}
            </span>
          ))}
        </div>

        <div className="mt-5 border-t border-[rgba(255,255,255,0.08)] pt-5">
          <p className="min-h-[6rem] text-[15px] leading-[1.65] text-[#D6D6DE]">
            {answer.slice(0, typedCount)}
            {playing && <span className="animate-blink text-[#9C90FF]">▍</span>}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {sources.map((source) => (
              <span
                key={source}
                className="rounded-[6px] border border-dashed border-[rgba(255,255,255,0.15)] px-2.5 py-1 font-[family-name:var(--font-geist-mono)] text-[12px] text-[#6B6B78]"
              >
                {source}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
