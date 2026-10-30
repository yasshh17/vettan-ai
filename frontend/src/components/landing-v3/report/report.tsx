"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { ArrowUpRight, Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DEMO,
  DEMO_CITATIONS,
  citationCounts,
  formatRecordedDate,
  monogram,
  reportBody,
  tokenizeReport,
  urlPath,
  type Block,
  type DemoSource,
  type Span,
} from "@/lib/research-demo"
import { TIER_SCALE } from "@/lib/constellation/particles"
import { SourceMap } from "@/lib/constellation/source-map"
import { CitationButton, CitationScope, useCitationSelection, useSourceState } from "../../landing-v2/demo/citation-selection"
import { citedTimes } from "../../landing-v2/demo/source-card"
import { TechnicalDetails } from "../../landing-v2/technical-details"
import { useReducedMotion } from "../../landing-v2/use-reduced-motion"
import { useCanvasLoop } from "../use-constellation"

const counts = citationCounts(DEMO_CITATIONS)
const WIDE_MIN = 1024

function useWide() {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_MIN}px)`)
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])
  return wide
}

// The sentence a citation supports: from the last sentence break before it.
function splitClaim(text: string): [string, string] {
  const at = Math.max(text.lastIndexOf(". "), text.lastIndexOf("? "), text.lastIndexOf("! "))
  return at < 0 ? ["", text] : [text.slice(0, at + 2), text.slice(at + 2)]
}

function Claim({ rank, text }: { rank: number; text: string }) {
  const { active } = useSourceState(rank)
  return (
    <span
      className={cn(
        "box-decoration-clone bg-[linear-gradient(180deg,rgb(124_111_240/0)_55%,rgb(124_111_240/0.35)_55%)] bg-no-repeat transition-[background-size,color] duration-500 motion-reduce:transition-none",
        active ? "text-white [background-size:100%_100%]" : "[background-size:0%_100%]"
      )}
    >
      {text}
    </span>
  )
}

// Like v62's Spans, plus a highlighter sweep over the claim behind each citation.
function ClaimSpans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === "cite") return <CitationButton key={i} citation={s.citation} />
        if (s.kind === "strong")
          return (
            <strong key={i} className="font-semibold text-v-ink-1">
              {s.text}
            </strong>
          )
        if (s.kind === "link")
          return (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-v-violet-300 underline">
              {s.text}
            </a>
          )
        const next = spans[i + 1]
        if (next?.kind !== "cite") return <span key={i}>{s.text}</span>
        const [before, claim] = splitClaim(s.text.replace(/\s+$/, ""))
        const tail = s.text.slice(before.length + claim.length)
        return (
          <span key={i}>
            {before}
            <Claim rank={next.citation.sourceRank} text={claim} />
            {tail}
          </span>
        )
      })}
    </>
  )
}

const citesIn = (spans: Span[]) => [...new Set(spans.flatMap((s) => (s.kind === "cite" ? [s.citation.sourceRank] : [])))]

function ReportBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex max-w-[68ch] flex-col gap-4 text-[16px] leading-[1.7] text-v-ink-body">
      {blocks.map((b, i) => {
        if (b.kind === "title")
          return (
            <h4 key={i} className="text-[19px] font-semibold leading-[1.4] text-v-ink-1">
              {b.text}
            </h4>
          )
        if (b.kind === "heading")
          return (
            <h4 key={i} className="mt-3 text-[17px] font-semibold leading-[1.4] text-v-ink-1">
              {b.text}
            </h4>
          )
        if (b.kind === "list")
          return (
            <ul key={i} data-cites={citesIn(b.items.flat()).join(",")} className="list-disc space-y-1.5 pl-5 marker:text-v-ink-4">
              {b.items.map((item, j) => (
                <li key={j}>
                  <ClaimSpans spans={item} />
                </li>
              ))}
            </ul>
          )
        return (
          <p key={i} data-cites={citesIn(b.spans).join(",")}>
            <ClaimSpans spans={b.spans} />
          </p>
        )
      })}
    </div>
  )
}

// Which sources the paragraph being read cites: the one crossing the middle of the screen.
function useReadingCites(root: React.RefObject<HTMLElement | null>) {
  const [ranks, setRanks] = useState<number[]>([])
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const seen = new Map<Element, number[]>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const cites = (e.target.getAttribute("data-cites") ?? "").split(",").filter(Boolean).map(Number)
          if (e.isIntersecting) seen.set(e.target, cites)
          else seen.delete(e.target)
        }
        const next = [...seen.values()].flat()
        setRanks((prev) => (prev.join() === next.join() ? prev : next))
      },
      { rootMargin: "-40% 0px -45% 0px" }
    )
    el.querySelectorAll("[data-cites]").forEach((p) => io.observe(p))
    return () => io.disconnect()
  }, [root])
  return ranks
}

function MiniMap({ inView }: { inView: number[] }) {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { hovered, selected } = useCitationSelection()
  const active = hovered ?? selected ?? 0
  const state = useRef({ active, inView })
  state.current = { active, inView }
  const { ready, redraw } = useCanvasLoop(canvasRef, {
    make: (canvas, tier) => new SourceMap(canvas, TIER_SCALE[tier]),
    frame: (map, clock) => map.draw(clock, state.current),
    reduced,
    stillClock: 0,
  })
  useEffect(() => redraw(), [active, inView, redraw])

  const source = active ? DEMO.sources[active - 1] : null
  const caption = source
    ? `${source.domain} · cited ${citedTimes(counts.get(source.rank) ?? 0)} in this report`
    : inView.length
      ? "Cited in the paragraph you're reading"
      : `The ${DEMO.sources.length} sources of this report`
  return (
    <div aria-hidden="true" className="relative aspect-[358/140] w-full overflow-hidden rounded-[14px] border border-v-line-2 bg-[#0b0b10] lg:aspect-[520/230]">
      <canvas ref={canvasRef} className="absolute inset-0 size-full transition-opacity duration-700" style={{ opacity: ready ? 1 : 0 }} />
      <p className="absolute left-3 top-2.5 font-v-mono text-[11px] text-v-ink-4">{caption}</p>
    </div>
  )
}

function SourceEntry({ source, inParagraph }: { source: DemoSource; inParagraph: boolean }) {
  const { active, selected } = useSourceState(source.rank)
  const { preview } = useCitationSelection()
  const path = urlPath(source.url)
  return (
    <li
      id={`source-${source.rank}`}
      onMouseEnter={() => preview(source.rank)}
      onMouseLeave={() => preview(null)}
      className={cn(
        "scroll-mt-[var(--header-clear)] rounded-[12px] border px-3.5 py-2.5 transition-[border-color,background-color,box-shadow] duration-150",
        active ? "border-v-accent-line-2 bg-v-wash shadow-v-lift" : inParagraph ? "border-[rgb(182_172_255/0.22)] bg-v-surface-1" : "border-v-line-2 bg-v-surface-1"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 flex-none items-center justify-center rounded-lg font-v-mono text-[12px]",
            active ? "bg-v-violet-400 text-v-on-violet" : "bg-v-wash-2 text-v-violet-200"
          )}
        >
          {monogram(source.domain)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-semibold text-v-ink-1">
            {source.domain}
            {selected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-v-wash-2 px-2 py-px text-[11px] font-semibold text-v-violet-200">
                <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                Selected
              </span>
            ) : inParagraph ? (
              <span className="font-v-mono text-[11px] font-normal text-v-violet-300">in this paragraph</span>
            ) : null}
          </p>
          <p title={`${source.domain}${path}`} className="truncate font-v-mono text-[11.5px] text-v-ink-4">
            {path}
          </p>
          <p className="font-v-mono text-[11px] text-v-ink-3">cited {counts.get(source.rank) ?? 0}×</p>
        </div>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[13px] font-medium text-v-violet-200 no-underline hover:text-v-ink-1"
        >
          Open page
          <span className="sr-only">
            {" "}
            for {source.domain}
            {path} (opens in a new tab)
          </span>
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </a>
      </div>
    </li>
  )
}

// On phones a selected citation opens this sheet. It's non-modal: the report keeps scrolling and the
// tapped sentence stays in view above it. Escape or Close returns focus to the citation.
function SourceSheet({ enabled }: { enabled: boolean }) {
  const { selected, toggle, lastCitation } = useCitationSelection()
  const reduced = useReducedMotion()
  const openRef = useRef<HTMLAnchorElement>(null)
  const source = selected ? DEMO.sources[selected - 1] : null
  const open = enabled && source !== null

  const close = () => {
    const c = lastCitation()
    if (selected && c) toggle(selected, c)
  }

  // Keep the chosen citation above the sheet, on open and whenever the source switches.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const c = lastCitation()
      const sheet = openRef.current?.closest<HTMLElement>("[role=dialog]")
      if (!c || !sheet) return
      const over = c.getBoundingClientRect().bottom + 40 - sheet.getBoundingClientRect().top
      if (over > 0) window.scrollBy({ top: over, behavior: reduced ? "auto" : "smooth" })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selected, lastCitation, reduced])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : close())} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            openRef.current?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            lastCitation()?.focus({ preventScroll: true })
          }}
          // Tapping another citation switches the sheet instead of closing it first.
          onInteractOutside={(e) => {
            if ((e.target as HTMLElement | null)?.closest("[data-citation]")) e.preventDefault()
          }}
          className="lv2 fixed inset-x-2 bottom-2 z-50 rounded-[18px] border border-[rgb(182_172_255/0.35)] bg-[rgb(13_13_18/0.98)] p-4 font-v-sans text-v-ink-1 shadow-[0_-10px_50px_rgb(0_0_0/0.6),0_0_40px_rgb(124_111_240/0.18)] backdrop-blur-md lg:hidden"
        >
          {source ? (
            <>
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-lg bg-v-violet-400 font-v-mono text-[13px] text-v-on-violet">
                  {monogram(source.domain)}
                </span>
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="text-[15px] font-semibold">{source.domain}</Dialog.Title>
                  <p className="truncate font-v-mono text-[11.5px] text-v-ink-4">{urlPath(source.url)}</p>
                </div>
                <Dialog.Close aria-label="Close source" className="flex size-11 items-center justify-center rounded-full border border-v-line-3 text-v-ink-1">
                  <X aria-hidden="true" className="size-4" />
                </Dialog.Close>
              </div>
              <p className="mt-2.5 font-v-mono text-[11.5px] text-v-ink-3">
                Cited {citedTimes(counts.get(source.rank) ?? 0)} in this report · source {source.rank} of {DEMO.sources.length}, in relevance order
              </p>
              <a
                ref={openRef}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex min-h-12 items-center justify-center gap-1.5 rounded-[12px] bg-v-violet-400 text-[15px] font-semibold text-v-on-violet no-underline"
              >
                Open page
                <span className="sr-only"> (opens in a new tab)</span>
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function LiveSelection() {
  const { selected } = useCitationSelection()
  const source = selected ? DEMO.sources[selected - 1] : null
  return (
    <p className="sr-only" aria-live="polite">
      {source ? `${source.domain} selected, source ${source.rank} of ${DEMO.sources.length}` : ""}
    </p>
  )
}

// On wide screens a selected source scrolls into view inside the sticky panel, never the page.
function revealInPanel(rank: number, reduced: boolean) {
  const el = document.getElementById(`source-${rank}`)
  const panel = el?.closest<HTMLElement>("[data-own-scroll]")
  if (!el || !panel || getComputedStyle(panel).position !== "sticky") return
  if (panel.scrollHeight <= panel.clientHeight + 1) return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  const behavior = reduced ? "auto" : "smooth"
  if (top < panel.scrollTop) panel.scrollTo({ top: top - 8, behavior })
  else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTo({ top: bottom - panel.clientHeight + 8, behavior })
}

export function ReportV3() {
  const reduced = useReducedMotion()
  const wide = useWide()
  const articleRef = useRef<HTMLElement>(null)
  const blocks = useMemo(() => reportBody(tokenizeReport(DEMO.report.markdown, DEMO.sources)), [])
  const inView = useReadingCites(articleRef)
  const onSelect = useCallback((rank: number) => revealInPanel(rank, reduced), [reduced])

  return (
    <CitationScope onSelect={onSelect}>
      <section id="example" aria-labelledby="example-title" className="scroll-mt-[var(--header-clear)] border-t border-v-line-1">
        <div className="mx-auto max-w-[1312px] px-4 py-20 sm:px-6 lg:px-12 lg:py-24">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[760px]">
              <p className="font-v-mono text-[12px] uppercase tracking-[0.08em] text-v-violet-200">Inspect a real report</p>
              <h2 id="example-title" className="mt-2.5 text-[28px] font-extrabold leading-[1.1] tracking-[-0.035em] text-v-ink-1 md:text-[38px]">
                Read the real output. Check every citation.
              </h2>
              <p className="mt-3 text-[16px] leading-[1.6] text-v-ink-2">
                Point at or select a citation to see its source, then open the page and check the claim yourself.
              </p>
            </div>
            <p className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-dashed border-v-line-3 px-3 py-1.5 font-v-mono text-[11.5px] text-v-ink-3 lg:self-auto">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-v-violet-300" />
              Recorded output, unedited · {formatRecordedDate(DEMO.recordedAt)}
            </p>
          </div>

          <div className="mt-8 lg:hidden">
            <MiniMap inView={inView} />
          </div>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_480px]">
            <article
              ref={articleRef}
              aria-labelledby="example-q"
              className="min-w-0 rounded-[14px] border border-v-line-2 bg-[linear-gradient(200deg,#1b1b23_0%,#15151c_45%,#121218_100%)] px-5 py-7 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_50px_110px_rgb(0_0_0/0.65)] sm:px-10 sm:py-9"
            >
              <h3 id="example-q" className="text-[21px] font-semibold leading-[1.35] tracking-[-0.01em] text-v-ink-1">
                {DEMO.query}
              </h3>
              <div className="mt-5">
                <ReportBody blocks={blocks} />
              </div>
            </article>

            <aside
              aria-labelledby="sources-title"
              data-own-scroll
              className="min-w-0 lg:sticky lg:top-[var(--header-clear)] lg:-m-1 lg:max-h-[calc(100vh-var(--header-clear)-16px)] lg:overflow-y-auto lg:overscroll-contain lg:p-1"
            >
              <div className="hidden lg:block">
                <MiniMap inView={inView} />
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <h3 id="sources-title" className="text-[15px] font-semibold text-v-ink-1">
                  Sources ({DEMO.sources.length})
                </h3>
                <span className="font-v-mono text-[11px] text-v-ink-4">In relevance order</span>
              </div>
              <ol className="mt-3 flex flex-col gap-2">
                {DEMO.sources.map((s) => (
                  <SourceEntry key={s.url} source={s} inParagraph={inView.includes(s.rank)} />
                ))}
              </ol>
              <p className="mt-3 text-[12.5px] leading-[1.55] text-v-ink-4">Page titles weren&apos;t recorded, so each shows its address.</p>
              <LiveSelection />
            </aside>
          </div>

          <TechnicalDetails />
        </div>
      </section>
      <SourceSheet enabled={!wide} />
    </CitationScope>
  )
}
