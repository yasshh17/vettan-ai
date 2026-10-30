"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEMO, HERO_CITED_SENTENCE, HERO_HEADING, formatRecordedDate, tokenizeReport, type Block } from "@/lib/research-demo"
import { portrait, project, viewFor, type CameraPose } from "@/lib/constellation/camera"
import { DOMAINS, QUESTION, RING, SOURCES, STREAMS, THREAD_ENDS } from "@/lib/constellation/geometry"
import { bezier, easeInOut, type Vec3 } from "@/lib/constellation/math"
import { STEP_NAMES, STORY_END, stepAt } from "@/lib/constellation/timeline"
import { ResearchField } from "../../landing-v2/hero/research-field"
import { CitationScope, useCitationSelection } from "../../landing-v2/demo/citation-selection"
import { Spans } from "../../landing-v2/demo/report-view"
import { useReducedMotion } from "../../landing-v2/use-reduced-motion"
import { useConstellation, type FrameFn } from "../use-constellation"

// Final camera poses, matching the approved renders. The intro swings in to these by 1.6s,
// before any label appears, so the labels never drift.
const WIDE = { pose: { pos: [1.4, 2.4, 8.6], look: [0.5, -0.1, 0] } as CameraPose, fov: 38, aspect: 1440 / 620, swing: 0.5, lift: 0.8, pull: 0.35 }
const TALL = { pose: { pos: [1.0, 0.4, 14.6], look: [0, 0.2, 0] } as CameraPose, fov: 40, aspect: 390 / 700, swing: 0.45, lift: 1.2, pull: 0.3 }
const STILL = 30
// The idle loop calms a few seconds after the replay and stops after a minute.
const SETTLE_AT = STORY_END + 4
const STOP_AT = 60

function swingIn(cfg: typeof WIDE, t: number): CameraPose {
  const k = easeInOut(t / 1.6)
  const { pos, look } = cfg.pose
  const off = [pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]]
  const ang = (1 - k) * cfg.swing
  const sc = 1 + (1 - k) * cfg.pull
  return {
    look,
    pos: [
      look[0] + (off[0] * Math.cos(ang) + off[2] * Math.sin(ang)) * sc,
      look[1] + off[1] * sc + (1 - k) * cfg.lift,
      look[2] + (-off[0] * Math.sin(ang) + off[2] * Math.cos(ang)) * sc,
    ],
  }
}

type Side = "left" | "right" | "up" | "down"
// Where each source's name sits, so names clear the threads and each other.
const WIDE_SIDES: Side[] = ["left", "up", "left", "down", "left"]
const TALL_SIDES: Side[] = ["right", "right", "right", "left", "up"]

interface Spot {
  x: number
  y: number
}

function cited(): Extract<Block, { kind: "paragraph" }> | null {
  const [block] = tokenizeReport(HERO_CITED_SENTENCE, DEMO.sources)
  return block?.kind === "paragraph" ? block : null
}

// Keeps the canvas's lit source in step with the citation being pointed at or selected.
function LitSync({ onLit }: { onLit: (rank: number) => void }) {
  const { hovered, selected } = useCitationSelection()
  useEffect(() => onLit(hovered ?? selected ?? 0), [hovered, selected, onLit])
  return null
}

function SourceStar({ rank, at, side, lit, shown }: { rank: number; at: Spot; side: Side; lit: boolean; shown: boolean }) {
  const { preview } = useCitationSelection()
  const source = DEMO.sources[rank - 1]
  const label: React.CSSProperties =
    side === "left"
      ? { left: at.x - 206, top: at.y - 8, width: 176, textAlign: "right" }
      : side === "right"
        ? { left: at.x + 14, top: at.y - 8 }
        : side === "up"
          ? { left: at.x - 80, top: at.y - 34, width: 160, textAlign: "center" }
          : { left: at.x - 80, top: at.y + 20, width: 160, textAlign: "center" }
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute size-[140px] rounded-full transition-opacity duration-300"
        style={{ left: at.x - 70, top: at.y - 70, opacity: lit ? 1 : 0, background: "radial-gradient(circle, rgb(244 242 255/0.45) 0, rgb(182 172 255/0.2) 30%, rgb(124 111 240/0) 70%)" }}
      />
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => preview(rank)}
        onMouseLeave={() => preview(null)}
        onFocus={() => preview(rank)}
        onBlur={() => preview(null)}
        tabIndex={shown ? undefined : -1}
        aria-hidden={shown ? undefined : true}
        className="absolute size-11 rounded-full"
        style={{ left: at.x - 22, top: at.y - 22 }}
      >
        <span className="sr-only">{source.domain} (opens in a new tab)</span>
      </a>
      <span aria-hidden="true" className={cn("pointer-events-none absolute whitespace-nowrap font-v-mono text-[11.5px] transition-colors [text-shadow:0_0_8px_#09090c,0_0_8px_#09090c]", lit ? "text-white" : "text-v-ink-2")} style={label}>
        {source.domain}
      </span>
    </>
  )
}

export function HeroV3() {
  const reduced = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const litRef = useRef(0)
  const stepRef = useRef(-1)
  const [lit, setLit] = useState(0)
  const [step, setStep] = useState(-1)
  const [width, setWidth] = useState(0)
  const [replayed, setReplayed] = useState(false)
  const excerpt = useMemo(cited, [])

  const tall = width > 0 && width < 768
  // The stars' glow grows with the stage, so labels beside them keep a matching distance.
  const gap = Math.round(width * 0.07) + 14
  const cfg = tall ? TALL : WIDE
  const height = width ? Math.round(width / cfg.aspect) : 0

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onLit = useCallback((rank: number) => {
    litRef.current = rank
    setLit(rank)
  }, [])

  const frame = useCallback<FrameFn>(
    (renderer, clock, size) => {
      const isTall = size.width < 768
      const c = isTall ? TALL : WIDE
      renderer.draw({ mode: "hero", t: clock, amb: clock, pose: swingIn(c, clock), fov: c.fov, portrait: isTall, lit: litRef.current })
      const s = stepAt(clock)
      if (s !== stepRef.current) {
        stepRef.current = s
        setStep(s)
      }
    },
    []
  )
  const { ready, restart, redraw } = useConstellation(canvasRef, { frame, reduced, stillClock: STILL, settleAt: SETTLE_AT, stopAt: STOP_AT })
  const shownStep = reduced ? STEP_NAMES.length - 1 : step
  // A still canvas (reduced motion, or after the loop stops) still lights the pointed-at source.
  useEffect(() => redraw(), [lit, redraw])

  // Overlay positions come from the same camera as the canvas, at its current size.
  const spots = useMemo(() => {
    if (!width || !height) return null
    const view = viewFor(cfg.pose, height, cfg.fov)
    const at = (p: Vec3): Spot => {
      const q = tall ? portrait(p[0], p[1], p[2]) : p
      const r = project(view, q[0], q[1], q[2], width, height)
      return r ? { x: r.x, y: r.y } : { x: -999, y: -999 }
    }
    const mid = bezier(STREAMS[tall ? 0 : 3], 0.5, [0, 0, 0])
    return {
      question: at(QUESTION),
      searches: at([mid[0], mid[1], mid[2]]),
      ring: at(RING),
      stars: SOURCES.map(at),
      threadTop: at(THREAD_ENDS[0]),
    }
  }, [width, height, tall, cfg])

  const show = (s: number, delay = 0): React.CSSProperties => ({
    opacity: shownStep >= s ? 1 : 0,
    transform: shownStep >= s ? "none" : "translateY(6px)",
    transition: `opacity .6s ease ${shownStep >= s ? delay : 0}s, transform .6s ease ${shownStep >= s ? delay : 0}s`,
  })

  const cardW = Math.min(320, Math.max(260, width * 0.24))
  const card = spots && !tall && width >= 1024 ? { left: Math.min(spots.threadTop.x + 10, width - cardW - 16), top: Math.max(0, spots.threadTop.y - 70) } : null

  const reportCard = (
    <article
      aria-labelledby="hero-report-q"
      className={cn(
        "flex flex-col gap-2.5 rounded-[16px] border border-[rgb(182_172_255/0.3)] bg-[rgb(13_13_18/0.92)] p-5 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_30px_80px_rgb(0_0_0/0.65),0_0_80px_rgb(124_111_240/0.18)]",
        card ? "absolute" : "relative mx-4 sm:mx-6"
      )}
      style={card ? { left: card.left, top: card.top, width: cardW, ...show(4, 0.9) } : show(4, 0.9)}
    >
      <p className="font-v-mono text-[11px] uppercase tracking-[0.06em] text-v-violet-200">The report, verbatim</p>
      <h2 id="hero-report-q" className="text-[14px] font-semibold leading-[1.4] text-v-ink-1">
        {DEMO.query}
      </h2>
      <p className="font-v-mono text-[11px] text-v-ink-4">{HERO_HEADING}</p>
      <p className="text-[13.5px] leading-[1.65] text-v-ink-body">{excerpt ? <Spans spans={excerpt.spans} /> : null}</p>
      <div className="flex items-center justify-between gap-2.5 border-t border-[rgb(255_255_255/0.07)] pt-2.5">
        <span className="text-[11.5px] text-v-ink-4">Recorded {formatRecordedDate(DEMO.recordedAt)} · unedited</span>
        <a href="#example" className="text-[12.5px] font-medium text-v-violet-200 no-underline">
          Full report ↓
        </a>
      </div>
    </article>
  )

  return (
    <section id="start" aria-labelledby="hero-title" className="relative overflow-hidden scroll-mt-[var(--header-clear)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_38%_at_50%_0%,rgb(124_111_240/0.3),rgb(124_111_240/0.08)_55%,rgb(124_111_240/0)_80%)]" />
      <div className="relative mx-auto flex max-w-[1240px] flex-col items-center px-4 pt-9 text-center sm:px-6 lg:px-12">
        <p className="lv2-fade inline-flex items-center gap-2.5 rounded-full border border-[rgb(182_172_255/0.25)] bg-v-wash px-3.5 py-1.5 font-v-mono text-[11px] uppercase tracking-[0.08em] text-v-violet-200 sm:text-[12px]">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-v-starlight shadow-[0_0_12px_3px_rgb(182_172_255/0.8)]" />
          Every cited point links to its page
        </p>
        <h1
          id="hero-title"
          className="lv2-fade mt-5 bg-[linear-gradient(180deg,#ffffff_30%,#c9c2ff_120%)] bg-clip-text text-[44px] font-extrabold leading-[0.98] tracking-[-0.05em] text-transparent min-[400px]:text-[52px] md:text-[72px] xl:text-[92px]"
        >
          Research you can check.
        </h1>
        <p className="lv2-fade mt-5 max-w-[660px] text-[17px] leading-[1.55] text-[#b4b4c0] md:text-[19px]">
          Ask a hard question. Vettan splits it into focused searches, runs them in parallel, reads excerpts
          from the most relevant pages and writes a report with citations you can open.
        </p>
        <div className="relative z-10 mt-8 flex w-full justify-center">
          <ResearchField appearance="observatory" />
        </div>
      </div>

      <CitationScope>
        <LitSync onLit={onLit} />
        <div className="@container relative mx-auto mt-6 w-full max-w-[1440px]">
          {/* The shape is CSS so the server HTML already has it: no jump when the script measures. */}
          <div ref={stageRef} className="relative aspect-[390/700] w-full @3xl:aspect-[1440/620]">
            <p className="sr-only">
              Recorded run: {DEMO.subQueries.length} searches in parallel, {DEMO.sources.length} sources, a cited report.
            </p>
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              className="absolute inset-0 size-full transition-opacity duration-700"
              style={{ opacity: ready ? 1 : 0 }}
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,rgb(9_9_12/0),#09090c_75%)]" />
            {spots ? (
              <div role="group" aria-label="Recorded example: how one real question became a cited report" className="absolute inset-0">
                <span aria-hidden="true" className={cn("absolute font-v-mono text-[11px] text-v-violet-200", !tall && "w-[100px] text-center")} style={{ left: spots.question.x + (tall ? gap : -50), top: spots.question.y + (tall ? -8 : 46), ...show(1, 0.3) }}>
                  Question
                </span>
                {/* On phones it wraps to two lines and stays inside the screen. */}
                <span aria-hidden="true" className={cn("absolute font-v-mono text-[11px] leading-[1.4] text-v-ink-3", tall ? "w-[84px]" : "whitespace-nowrap")} style={{ left: tall ? Math.min(spots.searches.x + 18, width - 92) : spots.searches.x - 70, top: spots.searches.y + (tall ? -14 : 40), ...show(1, 0.6) }}>
                  {DEMO.subQueries.length} searches, in parallel
                </span>
                <span aria-hidden="true" className="absolute font-v-mono text-[11px] leading-[1.4] text-v-ink-3" style={{ left: tall ? spots.ring.x + gap : spots.ring.x - 75, top: spots.ring.y + (tall ? -8 : 64), width: tall ? Math.max(90, width - spots.ring.x - gap - 8) : 150, textAlign: tall ? "left" : "center", ...show(2, 1.3) }}>
                  duplicates dropped, ranked
                </span>
                <div style={show(3, 0.4)}>
                  {spots.stars.map((at, i) => (
                    <SourceStar key={DOMAINS[i]} rank={i + 1} at={at} side={(tall ? TALL_SIDES : WIDE_SIDES)[i]} lit={lit === i + 1} shown={shownStep >= 3} />
                  ))}
                </div>
                {card ? reportCard : null}
              </div>
            ) : null}
          </div>
          {!card ? <div className="-mt-10 pb-4">{reportCard}</div> : null}
        </div>
      </CitationScope>

      <div className="relative mx-auto flex max-w-[1240px] flex-wrap items-center justify-center gap-3 px-4 pb-14 pt-4">
        <span className="font-v-mono text-[11px] text-v-ink-4">Recorded run, replayed</span>
        <ol aria-label="Research steps" className="flex flex-wrap justify-center gap-1.5">
          {STEP_NAMES.map((name, i) => (
            <li
              key={name}
              aria-current={i === shownStep ? "step" : undefined}
              className={cn(
                "rounded-full border px-2.5 py-1 font-v-mono text-[11px] transition-colors duration-300",
                i === shownStep ? "border-[rgb(182_172_255/0.6)] bg-[rgb(124_111_240/0.2)] text-white" : i < shownStep ? "border-v-line-2 text-v-violet-300" : "border-v-line-2 text-v-ink-4"
              )}
            >
              {String(i + 1).padStart(2, "0")} {name}
            </li>
          ))}
        </ol>
        {!reduced ? (
          <button
            type="button"
            onClick={() => {
              setReplayed(true)
              restart()
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-v-line-3 px-3.5 text-[12.5px] font-medium text-v-ink-2 transition-colors hover:border-v-line-hover hover:text-v-ink-1"
          >
            <RotateCcw aria-hidden="true" className="size-3" />
            Replay
          </button>
        ) : null}
        {/* Quiet on load; steps are read out only for a replay someone asked for. */}
        <p data-replay-status className="sr-only" aria-live="polite">
          {replayed && shownStep >= 0 ? `Step ${shownStep + 1} of ${STEP_NAMES.length}: ${STEP_NAMES[shownStep]}` : ""}
        </p>
      </div>
    </section>
  )
}
