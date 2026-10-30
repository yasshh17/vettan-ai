"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEMO, HERO_HEADING, formatRecordedDate } from "@/lib/research-demo"
import { poseAt, type CameraKey } from "@/lib/constellation/camera"
import { PLANE, QUESTION, QUERIES, DOMAINS, RING, SOURCES, STREAMS } from "@/lib/constellation/geometry"
import { bezier, clamp01 } from "@/lib/constellation/math"
import type { Caption } from "@/lib/constellation/renderer"
import { STEP_AT, stepAt, storyTime } from "@/lib/constellation/timeline"
import { activeStep, ACTIVE_LINE } from "../../landing-v2/story/research-story"
import { useReducedMotion } from "../../landing-v2/use-reduced-motion"
import { HERO_CITED_RANK, HERO_EXCERPT } from "../cited"
import { useConstellation, type FrameFn } from "../use-constellation"
import { MOMENTS } from "./moments"

// Camera keyframes per moment, from the approved story boards.
const WIDE_KEYS: CameraKey[] = [
  { t: 0.7, pos: [-3.5, 0.6, 6.4], look: [-4.1, 0, 0] },
  { t: 2.1, pos: [-1.6, 1.1, 8.6], look: [-2.4, 0, 0] },
  { t: 3.6, pos: [-1.5, 1.6, 8.4], look: [-2.3, 0, 0] },
  { t: 5.2, pos: [0.9, 1.0, 8.2], look: [0.5, -0.3, 0] },
  { t: 6.8, pos: [3.4, 0.7, 7.6], look: [3.2, 0, 0] },
  { t: 8.2, pos: [2.6, 0.5, 7.6], look: [2.6, 0, 0] },
]
const STRIP_KEYS: CameraKey[] = [
  { t: 0.7, pos: [-3.6, 0.6, 6.6], look: [-4.2, 0, 0] },
  { t: 2.1, pos: [-1.9, 1.1, 9.0], look: [-2.5, 0, 0] },
  { t: 3.6, pos: [-1.7, 1.6, 8.8], look: [-2.4, 0, 0] },
  { t: 5.2, pos: [1.0, 0.8, 9.8], look: [0.8, -0.15, 0] },
  { t: 6.8, pos: [3.0, 0.7, 8.4], look: [3.0, 0, 0] },
  { t: 8.2, pos: [2.6, 0.5, 8.0], look: [2.7, 0, 0] },
]
// The wide stage sits beside the steps from 1024px; below that a strip sticks under the header.
const WIDE_MIN = 1024
const RESULT = MOMENTS.length - 1

const fade = (t: number, from: number, len: number) => clamp01((t - from) / len)

// Scene labels drawn into the canvas so they travel with the camera. Every word is also in the steps.
export function captions(t: number, strip: boolean): Caption[] {
  const out: Caption[] = []
  const mono = { mono: true, size: strip ? 11 : 12 }
  const tmp = [0, 0, 0]
  if (!strip)
    out.push({ text: DEMO.query, at: QUESTION, dx: 0, dy: 74, alpha: fade(t, 0.4, 0.6) * (1 - fade(t, 1.45, 0.4)), color: "#ededf2", size: 15, weight: 500, align: "center" })
  QUERIES.forEach((q, k) => {
    bezier(STREAMS[k], 0.62, tmp)
    // Gone before the ring's labels appear, so the two never stack.
    const alpha = fade(t, 1.7 + k * 0.15, 0.5) * (1 - fade(t, 3.6, 0.4))
    out.push({ ...mono, text: strip ? String(k + 1) : `${k + 1}  ${q}`, at: [tmp[0], tmp[1], tmp[2]], dx: 14, dy: k < 2 ? -12 : 12, alpha, color: "#d6d6de" })
  })
  const { planned, succeeded } = DEMO.search
  out.push({ ...mono, text: `${succeeded} of ${planned} succeeded`, at: RING, dx: 0, dy: strip ? -44 : -62, alpha: fade(t, 4.0, 0.4) * (1 - fade(t, 5.6, 0.6)), color: "#c9c2ff", align: "center" })
  if (!strip)
    out.push({ ...mono, text: "duplicates dropped, ranked", at: RING, dx: 0, dy: 64, alpha: fade(t, 4.5, 0.4) * (1 - fade(t, 5.8, 0.6)), color: "#9b9ba8", align: "center" })
  // The result card covers the right of the wide stage, so the other labels clear out before it lands.
  const beforeCard = 1 - fade(t, STEP_AT[RESULT] - 0.4, 0.4)
  SOURCES.forEach((s, k) => {
    const cited = HERO_CITED_RANK === k + 1
    const on = t >= STEP_AT[RESULT] && cited
    const others = strip ? 1 - fade(t, 5.9, 0.4) : beforeCard
    const keep = on || (!strip && cited)
    // In the strip the report lines sit just right of the stars, so the cited name goes on the left.
    const left = strip && on
    out.push({ ...mono, text: DOMAINS[k], at: s, dx: left ? -20 : strip ? 20 : 28, dy: on ? (strip ? 30 : 20) : 0, alpha: fade(t, 5.0 + k * 0.15, 0.4) * (keep ? 1 : others), color: on ? "#ffffff" : "#c3c3cf", align: left ? "right" : undefined })
  })
  const fading = beforeCard
  out.push({ ...mono, text: `writing from the ${DEMO.sources.length} sources' excerpts`, at: [(PLANE.x0 + PLANE.x1) / 2, 0.75, 0], dx: 0, dy: -18, alpha: fade(t, 6.2, 0.4) * fading, color: "#c9c2ff", align: "center" })
  return out
}

function CitedSource() {
  const source = DEMO.sources[HERO_CITED_RANK - 1]
  if (!source) return null
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mx-0.5 inline-flex items-center rounded-v-chip border border-v-accent-line-2 bg-v-wash-2 px-1.5 align-[1px] font-v-mono text-[11.5px] leading-[1.6] text-v-violet-200 no-underline"
    >
      {source.domain}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

// The cited sentence as text: what the Result moment points at.
function Excerpt() {
  if (!HERO_EXCERPT) return null
  return (
    <>
      {HERO_EXCERPT.spans.map((s, i) =>
        s.kind === "cite" ? <CitedSource key={i} /> : s.kind === "link" ? null : <span key={i}>{s.text}</span>
      )}
    </>
  )
}

function StepExtra({ index }: { index: number }) {
  if (index === 0)
    return <p className="mt-4 rounded-[10px] border border-[rgb(182_172_255/0.22)] bg-[rgb(13_13_18/0.8)] px-3.5 py-3 text-[14.5px] font-medium text-v-ink-1">{DEMO.query}</p>
  if (index === 1)
    return (
      <ol className="mt-3.5 flex flex-col gap-1.5 text-[13.5px] text-v-ink-body">
        {DEMO.subQueries.map((q, i) => (
          <li key={q} className="flex min-h-9 items-center gap-2.5 rounded-lg border border-v-line-2 px-3">
            <span className="font-v-mono text-[11px] text-v-ink-4">{i + 1}</span>
            {q}
          </li>
        ))}
      </ol>
    )
  if (index === 3)
    return (
      <ul className="mt-3.5 flex flex-wrap gap-1.5 font-v-mono text-[11.5px] text-v-ink-body">
        {DEMO.sources.map((s) => (
          <li key={s.url} className="rounded-full border border-v-line-2 px-2.5 py-1">
            {s.domain}
          </li>
        ))}
      </ul>
    )
  if (index === RESULT)
    return (
      <>
        <div className="mt-3.5 flex flex-col gap-2 rounded-xl border border-[rgb(182_172_255/0.3)] bg-v-panel p-3.5 lg:hidden">
          <p className="font-v-mono text-[10.5px] uppercase tracking-[0.06em] text-v-violet-200">The report, verbatim</p>
          <p className="text-[14px] leading-[1.6] text-v-ink-body">
            <Excerpt />
          </p>
        </div>
        <a href="#example" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-v-violet-200 no-underline hover:text-v-ink-1">
          Inspect the full report
          <ArrowDown aria-hidden="true" className="size-3.5" />
        </a>
      </>
    )
  return null
}

function Rail({ active, onSelect, bars }: { active: number; onSelect: (i: number) => void; bars?: boolean }) {
  return (
    <nav aria-label="Story moments">
      <ol className={cn("grid grid-cols-6", bars ? "gap-1" : "gap-1.5")}>
        {MOMENTS.map((m, i) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={active === i ? "step" : undefined}
              aria-label={`${i + 1}. ${m.label}`}
              className={cn(
                "flex min-h-11 w-full flex-col justify-center gap-1.5 rounded-md px-1 text-left font-v-mono text-[11.5px] transition-colors",
                active === i ? "text-v-ink-1" : i < active ? "text-v-violet-300" : "text-v-ink-4 hover:text-v-ink-2"
              )}
            >
              <span aria-hidden="true" className={cn("h-0.5 w-full rounded-full transition-colors duration-300", i <= active ? "bg-v-violet-400" : "bg-v-line-3")} />
              {bars ? null : (
                <span aria-hidden="true">
                  {String(i + 1).padStart(2, "0")} {m.label}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

// "How Vettan works": the recorded run, scrubbed by native page scroll. The steps carry every
// word; the canvas beside them (or above them on smaller screens) is decoration.
export function StoryV3() {
  const reduced = useReducedMotion()
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])
  const stripRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stripCanvasRef = useRef<HTMLCanvasElement>(null)
  const [active, setActive] = useState(0)
  const [wide, setWide] = useState(true)
  const target = useRef(0)
  const shown = useRef(0)
  const lastClock = useRef(0)

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_MIN}px)`)
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  // Which moment the reader is on, and how far through it, as a time on the replay clock.
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const steps = stepRefs.current
      if (!steps[0]) return
      const vh = window.innerHeight
      const tops = steps.map((el) => (el ? el.getBoundingClientRect().top : Infinity))
      const i = activeStep(tops, vh)
      const el = steps[i]
      const local = el ? (vh * ACTIVE_LINE - tops[i]) / Math.max(1, el.offsetHeight) : 0
      target.current = storyTime(i, local)
      setActive((prev) => (prev === i ? prev : i))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  const makeFrame = useCallback(
    (strip: boolean): FrameFn =>
      (renderer, clock) => {
        // Under reduced motion each moment is one still: its finished state.
        const want = reduced ? storyTime(Math.max(0, stepAt(target.current)), 1) : target.current
        const dt = Math.max(0, clock - lastClock.current)
        lastClock.current = clock
        shown.current = reduced ? want : shown.current + (want - shown.current) * Math.min(1, dt * 5)
        const t = shown.current
        const keys = strip ? STRIP_KEYS : WIDE_KEYS
        const lit = t >= STEP_AT[RESULT] ? HERO_CITED_RANK : 0
        renderer.draw({ mode: "story", t, amb: clock, pose: poseAt(keys, t), fov: strip ? 44 : 40, lit, dimOthers: true, captions: captions(t, strip) })
      },
    [reduced]
  )
  const wideFrame = useMemo(() => makeFrame(false), [makeFrame])
  const stripFrame = useMemo(() => makeFrame(true), [makeFrame])
  // Only the visible stage ever draws: the other is display:none, so it never comes into view.
  const wideLoop = useConstellation(canvasRef, { frame: wideFrame, reduced, stillClock: 0 })
  const stripLoop = useConstellation(stripCanvasRef, { frame: stripFrame, reduced, stillClock: 0 })
  const { redraw: redrawWide } = wideLoop
  const { redraw: redrawStrip } = stripLoop
  // A still stage repaints when the reader moves to another moment.
  useEffect(() => {
    redrawWide()
    redrawStrip()
  }, [active, redrawWide, redrawStrip])

  const goTo = useCallback(
    (index: number) => {
      const el = stepRefs.current[index]
      if (!el) return
      setActive(index)
      const behavior = reduced ? "auto" : "smooth"
      const strip = stripRef.current
      if (!wide && strip) {
        // Land the step just under the sticky strip, not behind it.
        const y = window.scrollY + el.getBoundingClientRect().top - strip.getBoundingClientRect().bottom - 12
        window.scrollTo({ top: y, behavior })
      } else el.scrollIntoView({ behavior, block: "center" })
    },
    [reduced, wide]
  )

  return (
    <section id="how" aria-labelledby="how-title" className="relative scroll-mt-[var(--header-clear)] border-t border-v-line-1">
      <div className="mx-auto max-w-[1312px] px-4 pt-20 sm:px-6 lg:px-12 lg:pt-24">
        <div className="max-w-[720px]">
          <p className="font-v-mono text-[12px] uppercase tracking-[0.08em] text-v-violet-200">How Vettan works</p>
          <h2 id="how-title" className="mt-2.5 text-[30px] font-extrabold leading-[1.08] tracking-[-0.035em] text-v-ink-1 md:text-[40px]">
            Follow one real question to a cited report.
          </h2>
        </div>

        {/* Below 1024px: a short stage that sticks under the header while the steps scroll. */}
        <div ref={stripRef} className="sticky top-[68px] z-10 -mx-4 mt-8 bg-v-ground pb-1 sm:-mx-6 lg:hidden">
          <div aria-hidden="true" className="relative h-[240px] w-full sm:h-[300px]">
            <canvas ref={stripCanvasRef} className="absolute inset-0 size-full transition-opacity duration-700" style={{ opacity: stripLoop.ready ? 1 : 0 }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-[linear-gradient(180deg,rgb(9_9_12/0),#09090c)]" />
          </div>
          <div className="px-4 sm:px-6">
            <Rail active={active} onSelect={goTo} bars />
          </div>
        </div>

        <div className="mx-auto max-w-[720px] lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-14">
          <ol className="pb-10 lg:pb-[30vh]">
            {MOMENTS.map((m, i) => (
              <li
                key={m.id}
                ref={(el) => {
                  stepRefs.current[i] = el
                }}
                id={`moment-${i + 1}`}
                className="flex flex-col justify-center py-8 lg:min-h-[62vh] lg:py-10"
              >
                <p className="font-v-mono text-[12px] text-v-violet-200">
                  {String(i + 1).padStart(2, "0")} {m.label}
                </p>
                <h3
                  className={cn(
                    "mt-2.5 text-[22px] font-semibold leading-[1.22] tracking-[-0.015em] transition-colors duration-300 md:text-[26px]",
                    active === i ? "text-v-ink-1" : "text-v-ink-1 lg:text-v-ink-3"
                  )}
                >
                  {m.title}
                </h3>
                <p className={cn("mt-2.5 text-[16px] leading-[1.6] transition-colors duration-300", active === i ? "text-v-ink-2" : "text-v-ink-2 lg:text-v-ink-4")}>
                  {m.body}
                </p>
                <StepExtra index={i} />
              </li>
            ))}
          </ol>

          <div className="hidden lg:block">
            <div className="sticky top-[calc(var(--header-clear)+8px)] flex flex-col gap-3">
              <Rail active={active} onSelect={goTo} />
              <div aria-hidden="true" className="relative aspect-[4/3] w-full overflow-hidden rounded-[18px] border border-v-line-2 bg-v-ground shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_40px_100px_rgb(0_0_0/0.55)]">
                <canvas ref={canvasRef} className="absolute inset-0 size-full transition-opacity duration-700" style={{ opacity: wideLoop.ready ? 1 : 0 }} />
                <div
                  className="absolute left-[59.75%] top-[32.7%] flex w-[37.5%] flex-col gap-2 rounded-[14px] border border-[rgb(182_172_255/0.35)] bg-[rgb(13_13_18/0.97)] px-5 py-[18px] backdrop-blur-md shadow-[0_24px_60px_rgb(0_0_0/0.6),0_0_60px_rgb(124_111_240/0.2)] transition-[opacity,transform] delay-300 duration-[600ms] motion-reduce:transition-none"
                  style={{ opacity: active === RESULT ? 1 : 0, transform: active === RESULT ? "none" : "translateY(10px)" }}
                >
                  <p className="font-v-mono text-[11px] uppercase tracking-[0.06em] text-v-violet-200">The report, verbatim</p>
                  <p className="text-[14px] font-semibold text-v-ink-1">{HERO_HEADING}</p>
                  <p className="text-[13px] leading-[1.6] text-v-ink-body">
                    <Excerpt />
                  </p>
                </div>
              </div>
              <p className="text-center font-v-mono text-[11px] text-v-ink-4">
                The recorded run of {formatRecordedDate(DEMO.recordedAt)}, replayed at your scroll speed. The stage is illustrative; all words are real.
              </p>
            </div>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          Moment {active + 1} of {MOMENTS.length}: {MOMENTS[active].title}
        </p>
      </div>
    </section>
  )
}
