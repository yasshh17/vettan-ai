"use client"

import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEMO } from "@/lib/research-demo"

const p = DEMO.timing.pipeline_s
const r = DEMO.timing.request_s
const seconds = (n: number) => `${n} seconds`

const BREAKDOWN: [string, number][] = [
  ["Query decomposition", p.decomposition],
  ["Parallel search", p.search],
  ["Time to first token", p.ttft],
  ["Synthesis", p.synthesis],
]

// Server-side numbers from the one recorded run, with the caveats that keep them honest.
export function TechnicalDetails() {
  const [open, setOpen] = useState(false)
  const id = useId()
  const panelId = `${id}-tech-details`

  return (
    <div className="mt-8 rounded-v-card border border-v-line-2 bg-[rgb(255_255_255/0.015)]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-v-card px-5 text-left text-[14.5px] font-medium text-v-ink-1 transition-colors hover:bg-[rgb(255_255_255/0.04)]"
      >
        <span>Technical run details</span>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-v-ink-3">
          <span>{open ? "Hide" : "Show"}</span>
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
        <div id={panelId} className="px-5 pb-5 pt-1">
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <div>
              <dt className="text-[13px] text-v-ink-3">Research pipeline</dt>
              <dd className="mt-0.5 font-v-mono text-[18px] text-v-ink-1">{seconds(p.total)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-v-ink-3">Full API request</dt>
              <dd className="mt-0.5 font-v-mono text-[18px] text-v-ink-1">{seconds(r.total)}</dd>
            </div>
          </dl>
          <p className="mb-1 mt-4 text-[13px] font-semibold text-v-ink-2">Pipeline breakdown</p>
          <dl className="max-w-[480px]">
            {BREAKDOWN.map(([label, value], i) => (
              <div key={label} className={cn("flex justify-between gap-3 py-2 text-[14px]", i > 0 && "border-t border-v-line-1")}>
                <dt className="text-v-ink-3">{label}</dt>
                <dd className="font-v-mono text-v-ink-1">{seconds(value)}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-4 list-disc pl-[18px] text-[13px] leading-[1.6] text-v-ink-3">
            <li>The two totals measure different spans, and the breakdown sits inside the pipeline. Don&apos;t add them together.</li>
            <li>These are server-side measurements from one recorded run, not a benchmark of typical performance.</li>
            <li>They don&apos;t show the latency a browser would observe.</li>
            <li>The animation on this page is an accelerated replay, not real time.</li>
          </ul>
        </div>
      ) : null}
    </div>
  )
}
