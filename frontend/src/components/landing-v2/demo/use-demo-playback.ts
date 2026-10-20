"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { PLAYBACK_MS, STAGES, type Stage } from "@/lib/research-demo"
import { useReducedMotion } from "../use-reduced-motion"

const STEPS = ["decompose", "search", "select", "synthesize", "done"] as const
const LAST = STAGES.length - 1

export interface DemoPlayback {
  stage: Stage
  index: number
  playing: boolean
  replay: () => void
  skip: () => void
}

// Replays the recorded run on a compressed clock once the panel is in view. One pass, no loop.
export function useDemoPlayback(ref: RefObject<Element | null>): DemoPlayback {
  const reduced = useReducedMotion()
  const [inView, setInView] = useState(false)
  const [index, setIndex] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const started = useRef(false)

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  const skip = useCallback(() => {
    clear()
    setIndex(LAST)
  }, [clear])

  const replay = useCallback(() => {
    clear()
    if (reduced) {
      setIndex(LAST)
      return
    }
    setIndex(0)
    for (const step of STEPS) {
      timers.current.push(setTimeout(() => setIndex(STAGES.indexOf(step)), PLAYBACK_MS[step]))
    }
  }, [clear, reduced])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref])

  useEffect(() => {
    if (reduced) skip()
  }, [reduced, skip])

  useEffect(() => {
    if (inView && !started.current) {
      started.current = true
      replay()
    }
  }, [inView, replay])

  useEffect(() => clear, [clear])

  return { stage: STAGES[index], index, playing: index > 0 && index < LAST, replay, skip }
}
