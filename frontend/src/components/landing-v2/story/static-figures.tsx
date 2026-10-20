"use client"

import { Check } from "lucide-react"
import { DEMO, DEMO_CITATIONS, citationCounts, monogram } from "@/lib/research-demo"
import { SourceCard } from "../demo/source-card"

const counts = citationCounts(DEMO_CITATIONS)

// What each moment shows without the animated stage: below 1024px and under reduced motion.
export function StaticFigure({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="rounded-v-card border border-v-line-3 bg-v-panel px-4 py-3.5">
        <p className="font-v-mono text-[11px] text-v-ink-4">Question</p>
        <p className="mt-1 text-[15px] font-medium leading-[1.4] text-v-ink-1">{DEMO.query}</p>
      </div>
    )
  }
  if (index === 1) {
    return (
      <ol className="flex flex-col gap-1.5">
        {DEMO.subQueries.map((q, i) => (
          <li key={q} className="flex items-center gap-2.5 rounded-v-control border border-v-line-2 bg-v-surface-1 px-3 py-2.5">
            <span className="font-v-mono text-[11px] text-v-ink-4">{i + 1}</span>
            <span className="min-w-0 flex-1 text-[13.5px] leading-[1.35] text-v-ink-2">{q}</span>
          </li>
        ))}
      </ol>
    )
  }
  if (index === 2) {
    // The same searches as the plan above, by number, so nothing is listed twice.
    return (
      <div className="rounded-v-card border border-v-line-2 bg-v-surface-1 px-4 py-3.5">
        <p className="mb-2 text-[12.5px] text-v-ink-3">
          Searches 1–{DEMO.subQueries.length} from the plan above, running at once
        </p>
        <ol aria-label="Search status" className="flex flex-col gap-1">
          {DEMO.subQueries.map((q, i) => (
            <li key={q} className="flex min-h-8 items-center gap-2.5">
              <span className="flex size-6 flex-none items-center justify-center rounded-full border border-v-accent-line font-v-mono text-[11px] text-v-violet-300">
                {i + 1}
              </span>
              <span aria-hidden="true" className="h-0.5 flex-1 rounded-full bg-v-violet-400" />
              <span className="inline-flex items-center gap-[3px] text-[12px] font-semibold text-v-violet-300">
                <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                Done
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2.5 flex items-center gap-1 text-[13px] font-semibold text-v-violet-200">
          <Check aria-hidden="true" className="size-[13px]" strokeWidth={2.5} />
          {DEMO.search.succeeded} of {DEMO.search.planned} succeeded
        </p>
      </div>
    )
  }
  if (index === 3) {
    return (
      <ol className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
        {DEMO.sources.map((s) => (
          <li key={s.url}>
            <SourceCard source={s} cited={counts.get(s.rank)} />
          </li>
        ))}
      </ol>
    )
  }
  if (index === 4) {
    return (
      <div aria-hidden="true" className="flex items-center gap-3">
        <div className="flex">
          {DEMO.sources.map((s, i) => (
            <span
              key={s.url}
              className="flex size-8 items-center justify-center rounded-full border border-v-line-3 bg-v-panel font-v-mono text-[12px] text-v-violet-300"
              style={{ marginLeft: i === 0 ? 0 : -6 }}
            >
              {monogram(s.domain)}
            </span>
          ))}
        </div>
        <span className="h-px flex-1 bg-[linear-gradient(90deg,rgb(124_111_240/0.55),rgb(255_255_255/0.08))]" />
        <div className="flex w-28 flex-col gap-1.5 rounded-v-control border border-v-accent-line bg-v-panel p-2.5">
          <div className="h-2 w-3/4 rounded-[3px] bg-v-line-3" />
          <div className="h-1.5 rounded-[3px] bg-v-line-2" />
          <div className="h-1.5 w-5/6 rounded-[3px] bg-v-line-2" />
        </div>
      </div>
    )
  }
  return (
    <a
      href="#example"
      className="flex min-h-11 items-center justify-between rounded-v-card border border-v-accent-line bg-v-wash px-4 py-3 text-[14px] font-medium text-v-violet-200 no-underline"
    >
      <span>Read the full report</span>
      <span aria-hidden="true">↓</span>
    </a>
  )
}
