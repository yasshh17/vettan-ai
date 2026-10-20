"use client"

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, ArrowUpRight, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DEMO,
  DEMO_CITATIONS,
  EXAMPLE_EXCERPT,
  EXAMPLE_HEADING,
  citationCounts,
  formatRecordedDate,
  monogram,
  reportBody,
  tokenizeReport,
  urlPath,
  type DemoSource,
} from "@/lib/research-demo"
import {
  centerCitationY,
  headerClearance,
  revealDelta,
  scrollByDelta,
  scrollToY,
  showLessDelta,
  viewportOf,
} from "@/lib/scroll-clearance"
import { CitationScope, useCitationSelection, useSourceState } from "./demo/citation-selection"
import { ReportView, Spans } from "./demo/report-view"
import { citedTimes } from "./demo/source-card"
import { TechnicalDetails } from "./technical-details"
import { useReducedMotion } from "./use-reduced-motion"

const counts = citationCounts(DEMO_CITATIONS)

function behavior(reduced: boolean): ScrollBehavior {
  return reduced ? "auto" : "smooth"
}

// Brings a selected source into view. Below 1024px the panel is part of the page; above it the
// panel is sticky and scrolls on its own, so the page stays where the reader is.
function revealSource(rank: number, reduced: boolean) {
  const el = document.getElementById(`source-${rank}`)
  if (!el) return
  const panel = el.closest<HTMLElement>("[data-lv2-own-scroll]")
  const sticky = panel && getComputedStyle(panel).position === "sticky"
  if (!sticky) {
    const view = viewportOf(el)
    scrollByDelta(el, revealDelta(el.getBoundingClientRect(), headerClearance(), view.top, view.bottom), behavior(reduced))
    return
  }
  if (panel.scrollHeight <= panel.clientHeight + 1) return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  if (top < panel.scrollTop) panel.scrollTo({ top: top - 8, behavior: behavior(reduced) })
  else if (bottom > panel.scrollTop + panel.clientHeight)
    panel.scrollTo({ top: bottom - panel.clientHeight + 8, behavior: behavior(reduced) })
}

function SourceEntry({ source, reduced }: { source: DemoSource; reduced: boolean }) {
  const { active, selected } = useSourceState(source.rank)
  const { lastCitation } = useCitationSelection()
  const path = urlPath(source.url)
  const n = counts.get(source.rank) ?? 0

  const backToCitation = () => {
    const c = lastCitation()
    if (!c || !c.isConnected) return
    const clear = headerClearance()
    const view = viewportOf(c)
    const y = centerCitationY(clear, view.bottom - view.top, c.getBoundingClientRect().height)
    scrollToY(c, y, behavior(reduced))
    c.focus({ preventScroll: true })
  }

  return (
    <li
      id={`source-${source.rank}`}
      className={cn(
        "scroll-mt-[var(--header-clear)] rounded-v-card border px-4 py-3.5 transition-[border-color,background-color,box-shadow] duration-150",
        active ? "border-v-accent-line-2 bg-v-wash shadow-v-lift" : "border-v-line-2 bg-v-surface-1"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-8 flex-none items-center justify-center rounded-v-control bg-v-wash-2 font-v-mono text-[13px] text-v-violet-300"
        >
          {monogram(source.domain)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] font-semibold text-v-ink-1">
            {source.domain}
            {selected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-v-wash-2 px-2 py-px text-[11.5px] font-semibold text-v-violet-200">
                <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                Selected
              </span>
            ) : null}
          </p>
          <p title={`${source.domain}${path}`} className="mt-0.5 truncate font-v-mono text-[12px] text-v-ink-4">
            {path}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-v-ink-3">Cited {citedTimes(n)} in this report</span>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-v-violet-300 no-underline hover:text-v-ink-1"
        >
          Open page{" "}
          <span className="sr-only">
            for {source.domain}
            {path} (opens in a new tab)
          </span>
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </a>
      </div>
      {selected ? (
        <button
          type="button"
          onClick={backToCitation}
          className="mt-0.5 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-v-violet-300 lg:hidden"
        >
          <ArrowUp aria-hidden="true" className="size-3.5" />
          Back to the citation
        </button>
      ) : null}
    </li>
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

export function ExampleReport() {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const restore = useRef(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const full = useMemo(() => reportBody(tokenizeReport(DEMO.report.markdown, DEMO.sources)), [])
  const excerpt = useMemo(() => tokenizeReport(EXAMPLE_EXCERPT, DEMO.sources)[0], [])
  const onSelect = useCallback((rank: number) => revealSource(rank, reduced), [reduced])

  // After "Show less" has rendered: one instant scroll so the heading sits below the header,
  // unless that would push the focused toggle off screen.
  useLayoutEffect(() => {
    if (open || !restore.current) return
    restore.current = false
    const heading = document.getElementById("example-title")
    const toggle = toggleRef.current
    if (!heading || !toggle) return
    const view = viewportOf(heading)
    const delta = showLessDelta(heading.getBoundingClientRect(), toggle.getBoundingClientRect(), view.top, view.bottom, headerClearance())
    scrollByDelta(heading, delta, "auto")
  }, [open])

  return (
    <CitationScope onSelect={onSelect}>
      <section id="example" aria-labelledby="example-title" className="border-t border-v-line-1">
        <div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-12">
          <div className="max-w-[680px]">
            <h2
              id="example-title"
              className="scroll-mt-[var(--header-clear)] text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-v-ink-1 md:text-[36px]"
            >
              Inspect a real report
            </h2>
            <p className="mt-3.5 text-[17px] leading-[1.55] text-v-ink-2">
              Below is unedited output from one recorded run. Select a citation to see its source, then open the page to
              check it yourself.
            </p>
          </div>

          {/* minmax(0,1fr): a long source path mustn't widen the column past a phone screen. */}
          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-16 lg:grid-cols-[minmax(0,1fr)_360px]">
            <article aria-labelledby="example-q" className="min-w-0 rounded-v-panel border border-v-line-2 bg-v-panel">
              <div className="border-b border-v-line-1 px-6 py-5">
                <p className="inline-flex rounded-v-chip border border-dashed border-v-line-3 px-2 py-0.5 text-[12px] text-v-ink-3">
                  Recorded output, unedited. {formatRecordedDate(DEMO.recordedAt)}
                </p>
                <h3 id="example-q" className="mt-3 text-[19px] font-semibold leading-[1.4] text-v-ink-1">
                  {DEMO.query}
                </h3>
              </div>
              <div className="p-4 sm:p-6">
                {/* Always present, so the toggle's aria-controls points at a real element. */}
                <div id="full-report">
                  {open ? (
                    <ReportView blocks={full} />
                  ) : (
                    <>
                      <p className="mb-1.5 text-[13px] font-semibold text-v-ink-1">{EXAMPLE_HEADING}</p>
                      <p className="max-w-[68ch] text-[16px] leading-[1.7] text-v-ink-body">
                        {excerpt?.kind === "paragraph" ? <Spans spans={excerpt.spans} /> : null}
                      </p>
                    </>
                  )}
                </div>
                <button
                  ref={toggleRef}
                  type="button"
                  aria-expanded={open}
                  aria-controls="full-report"
                  onClick={() => {
                    if (open) restore.current = true
                    setOpen((v) => !v)
                  }}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-v-button border border-v-line-3 bg-v-surface-2 px-4 text-[14px] font-medium text-v-ink-1 transition-colors hover:bg-[rgb(255_255_255/0.04)]"
                >
                  {open ? "Show less" : "Read the full report"}
                </button>
              </div>
            </article>

            <aside
              aria-labelledby="sources-title"
              data-lv2-own-scroll
              className="min-w-0 lg:sticky lg:top-24 lg:-m-1 lg:max-h-[calc(100vh-112px)] lg:overflow-y-auto lg:overscroll-contain lg:p-1"
            >
              <h3 id="sources-title" className="text-[15px] font-semibold text-v-ink-1">
                Sources ({DEMO.sources.length})
              </h3>
              <p className="mt-1 text-[13px] leading-[1.55] text-v-ink-3">
                In relevance order. Page titles weren&apos;t recorded, so each shows its address.
              </p>
              <ol className="mt-3 flex flex-col gap-2">
                {DEMO.sources.map((s) => (
                  <SourceEntry key={s.url} source={s} reduced={reduced} />
                ))}
              </ol>
              <LiveSelection />
            </aside>
          </div>

          <TechnicalDetails />
        </div>
      </section>
    </CitationScope>
  )
}
