"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { buildParticles, pickTier, TIER_SCALE } from "@/lib/constellation/particles"
import { ConstellationRenderer, type Fonts } from "@/lib/constellation/renderer"
import { framePlan } from "@/lib/constellation/timeline"

export interface Size {
  width: number
  height: number
}

// Draws one frame. `clock` is seconds of running time since the last (re)start.
export type FrameFn<R = ConstellationRenderer> = (renderer: R, clock: number, size: Size) => void

interface Resizable {
  resize(width: number, height: number, dpr: number): void
}

export type Tier = ReturnType<typeof pickTier>

const FALLBACK_SANS = "ui-sans-serif, system-ui, sans-serif"
const FALLBACK_MONO = "ui-monospace, monospace"

// next/font hashes the family names, so read them from the variables it sets on <body>.
function pageFonts() {
  const body = getComputedStyle(document.body)
  const sans = body.getPropertyValue("--font-geist-sans").trim()
  const mono = body.getPropertyValue("--font-geist-mono").trim()
  return { sans: sans ? `${sans}, ${FALLBACK_SANS}` : FALLBACK_SANS, mono: mono ? `${mono}, ${FALLBACK_MONO}` : FALLBACK_MONO }
}

function deviceTier() {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return pickTier({ width: window.innerWidth, cores: nav.hardwareConcurrency, saveData: nav.connection?.saveData })
}

interface Options<R> {
  // Builds the scene once the page is idle; the tier sets how many particles it can afford.
  make: (canvas: HTMLCanvasElement, tier: Tier, fonts: Fonts) => R
  frame: FrameFn<R>
  reduced: boolean
  stillClock: number
  // After `settleAt` seconds the loop drops to IDLE_FPS, and at `stopAt` it keeps its last frame.
  settleAt?: number
  stopAt?: number
}

// Runs a canvas scene: starts once the page is idle, pauses off-screen and in background tabs,
// and under reduced motion draws `stillClock` once instead of animating.
export function useCanvasLoop<R extends Resizable>(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { make, frame, reduced, stillClock, settleAt = Infinity, stopAt = Infinity }: Options<R>
) {
  const [ready, setReady] = useState(false)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const makeRef = useRef(make)
  makeRef.current = make
  const clockRef = useRef(0)
  const controls = useRef<{ wake: () => void; redraw: () => void } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: R | null = null
    let raf = 0
    let last = 0
    let inView = true
    let disposed = false
    const size: Size = { width: 0, height: 0 }

    const drawOnce = () => {
      if (renderer && size.width) frameRef.current(renderer, reduced ? stillClock : clockRef.current, size)
    }
    const running = () => !reduced && inView && !document.hidden
    const tick = (now: number) => {
      raf = 0
      if (!renderer || !running()) return
      const plan = framePlan(clockRef.current, last ? now - last : Infinity, settleAt, stopAt)
      if (plan === "stop") return
      if (plan === "draw") {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
        last = now
        clockRef.current += dt
        frameRef.current(renderer, clockRef.current, size)
      }
      raf = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (raf || !running()) return
      last = 0
      raf = requestAnimationFrame(tick)
    }
    const sleep = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    const resize = () => {
      if (!renderer) return
      const tier = deviceTier()
      const dpr = Math.min(tier === "low" ? 1.5 : 2, window.devicePixelRatio || 1)
      size.width = canvas.clientWidth
      size.height = canvas.clientHeight
      renderer.resize(size.width, size.height, dpr)
      drawOnce()
    }
    // Without these (old browsers, jsdom) the page keeps its still poster and skips the animation.
    if (typeof ResizeObserver === "undefined" || typeof IntersectionObserver === "undefined") return
    const ro = new ResizeObserver(resize)
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting)
      if (inView) wake()
      else sleep()
    })
    const onVisibility = () => (document.hidden ? sleep() : wake())

    const start = async () => {
      await document.fonts?.ready
      if (disposed) return
      try {
        renderer = makeRef.current(canvas, deviceTier(), pageFonts())
      } catch {
        return
      }
      ro.observe(canvas)
      io.observe(canvas)
      document.addEventListener("visibilitychange", onVisibility)
      resize()
      controls.current = { wake, redraw: () => (raf ? undefined : drawOnce()) }
      setReady(true)
      wake()
    }
    const idle = window.requestIdleCallback ? window.requestIdleCallback(() => void start(), { timeout: 600 }) : window.setTimeout(() => void start(), 1)

    return () => {
      disposed = true
      controls.current = null
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
      sleep()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [canvasRef, reduced, stillClock, settleAt, stopAt])

  const restart = useCallback(() => {
    clockRef.current = 0
    controls.current?.wake()
  }, [])
  // Repaints a still canvas, e.g. when a source is lit while nothing is animating.
  const redraw = useCallback(() => controls.current?.redraw(), [])

  return { ready, restart, redraw }
}

const makeConstellation = (canvas: HTMLCanvasElement, tier: Tier, fonts: Fonts) =>
  new ConstellationRenderer(canvas, buildParticles(TIER_SCALE[tier]), fonts)

// The 3D evidence constellation (hero and story).
export function useConstellation(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: Omit<Options<ConstellationRenderer>, "make">
) {
  return useCanvasLoop(canvasRef, { ...options, make: makeConstellation })
}
