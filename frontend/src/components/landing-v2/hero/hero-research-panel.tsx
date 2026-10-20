"use client"

import { useMemo, useRef, useState } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DEMO,
  HERO_CITED_SENTENCE,
  HERO_HEADING,
  HERO_TAKEAWAY,
  TAKEAWAYS_HEADING,
  formatRecordedDate,
  tokenizeReport,
  type Block,
} from "@/lib/research-demo"
import { CitationScope } from "../demo/citation-selection"
import { Spans } from "../demo/report-view"
import { HeroSourceCard } from "../demo/source-card"
import { useDemoPlayback } from "../demo/use-demo-playback"

const EASE = "cubic-bezier(.22,1,.36,1)"

// The canvas HERO table: each item fades up 8px once the replay reaches its stage.
function rise(shown: boolean, delayMs: number): React.CSSProperties {
  return {
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : "translateY(8px)",
    transition: `opacity .45s ${EASE} ${delayMs}ms, transform .45s ${EASE} ${delayMs}ms`,
  }
}

const fade = (shown: boolean, delayMs: number): React.CSSProperties => ({
  opacity: shown ? 1 : 0,
  transition: `opacity .3s ease ${delayMs}ms`,
})

function spansOf(markdown: string): Block {
  const [block] = tokenizeReport(markdown, DEMO.sources)
  if (block?.kind !== "paragraph") throw new Error("Hero excerpt is not a paragraph")
  return block
}

export function HeroResearchPanel() {
  const ref = useRef<HTMLDivElement>(null)
  const { index, playing, replay, skip } = useDemoPlayback(ref)
  const [allSources, setAllSources] = useState(false)
  const takeaway = useMemo(() => spansOf(HERO_TAKEAWAY), [])
  const cited = useMemo(() => spansOf(HERO_CITED_SENTENCE), [])

  return (
    <CitationScope>
      <div
        ref={ref}
        data-playback-stage={index}
        className="relative rounded-v-panel border border-v-line-2 bg-v-panel p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_24px_60px_rgb(0_0_0/0.4)] sm:p-6"
      >
        <p className="text-[17px] font-semibold leading-[1.4] text-v-ink-1">{DEMO.query}</p>

        <div className="mt-5 flex flex-col gap-5">
          <section aria-label="Searches">
            <h3 className="mb-2 text-[12.5px] font-medium text-v-ink-4">{DEMO.subQueries.length} focused searches</h3>
            <ol className="flex flex-col gap-1">
              {DEMO.subQueries.map((q, i) => (
                <li
                  key={q}
                  data-lv2-step
                  style={rise(index >= 1, i * 60)}
                  className="flex items-center gap-2.5 rounded-v-control bg-[rgb(255_255_255/0.025)] px-3 py-[7px]"
                >
                  <span className="min-w-0 flex-1 text-[13.5px] leading-[1.4] text-v-ink-2">{q}</span>
                  <span aria-hidden="true" data-lv2-step className="text-v-violet-300" style={fade(index >= 2, 200 + i * 40)}>
                    <Check className="size-3.5" strokeWidth={2.5} />
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="Sources">
            <h3 className="mb-2 text-[12.5px] font-medium text-v-ink-4">{DEMO.sources.length} sources</h3>
            <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {DEMO.sources.map((s, i) => (
                <li
                  key={s.url}
                  data-lv2-step
                  style={rise(index >= 3, i * 70)}
                  className={cn(!allSources && i >= 3 && "hidden sm:block")}
                >
                  <HeroSourceCard source={s} />
                </li>
              ))}
            </ol>
            {!allSources ? (
              <button
                type="button"
                onClick={() => setAllSources(true)}
                className="mt-1.5 min-h-11 text-[13px] font-medium text-v-violet-300 sm:hidden"
              >
                Show 2 more sources
              </button>
            ) : null}
          </section>

          <section aria-label="From the report, verbatim" data-lv2-step style={rise(index >= 4, 0)}>
            <h3 className="mb-2 text-[12.5px] font-medium text-v-ink-4">From the report, verbatim</h3>
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-1 font-v-mono text-[11px] text-v-ink-4">{TAKEAWAYS_HEADING}</p>
                <p className="text-[14.5px] leading-[1.6] text-v-ink-1">
                  {takeaway.kind === "paragraph" ? <Spans spans={takeaway.spans} /> : null}
                </p>
              </div>
              <div>
                <p className="mb-1 font-v-mono text-[11px] text-v-ink-4">{HERO_HEADING}</p>
                <p className="text-[14px] leading-[1.65] text-v-ink-body">
                  {cited.kind === "paragraph" ? <Spans spans={cited.spans} /> : null}
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-v-line-1 pt-3.5">
          <p className="text-[12.5px] leading-[1.5] text-v-ink-4">
            Recorded example from {formatRecordedDate(DEMO.recordedAt)}. Real output, replayed.
          </p>
          {playing ? (
            <button
              type="button"
              onClick={skip}
              aria-label="Skip to the end of the replay"
              className="inline-flex min-h-11 shrink-0 items-center rounded-v-control border border-v-line-3 px-3 text-[13px] font-medium text-v-ink-3 transition-colors hover:border-v-line-hover hover:text-v-ink-1 sm:min-h-9"
            >
              Skip
            </button>
          ) : (
            <button
              type="button"
              onClick={replay}
              aria-label="Replay the recorded example"
              className="inline-flex min-h-11 shrink-0 items-center rounded-v-control border border-v-line-3 px-3 text-[13px] font-medium text-v-ink-3 transition-colors hover:border-v-line-hover hover:text-v-ink-1 sm:min-h-9"
            >
              Replay
            </button>
          )}
        </div>
      </div>
    </CitationScope>
  )
}
