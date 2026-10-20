"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { monogram, urlPath, type DemoSource } from "@/lib/research-demo"
import { useSourceState } from "./citation-selection"

const citedTimes = (n: number) => `${n} ${n === 1 ? "time" : "times"}`

// Link names are built from the visible text (WCAG 2.5.3, label in name), with screen-reader-only
// additions for what isn't shown: the rest of the address and that it opens a new tab.

// Hero list item: monogram and host. Shows "Cited" while its citation is selected.
export function HeroSourceCard({ source }: { source: DemoSource }) {
  const { active, selected } = useSourceState(source.rank)
  const path = urlPath(source.url)
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.url}
      data-source-rank={source.rank}
      className={cn(
        "flex min-h-10 items-center gap-2.5 rounded-v-control border px-2.5 py-1.5 no-underline transition-[border-color,background-color] duration-150",
        active ? "border-v-accent-line-2 bg-v-wash shadow-v-lift" : "border-v-line-2 bg-v-surface-1 hover:border-v-line-hover"
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-v-chip bg-v-wash-2 font-v-mono text-[11.5px] text-v-violet-300"
      >
        {monogram(source.domain)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-v-ink-1">
        {source.domain}
        <span className="sr-only">{path}</span>
      </span>
      {selected ? (
        <span className="inline-flex items-center gap-[3px] text-[11.5px] font-semibold text-v-violet-200">
          <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
          Cited
        </span>
      ) : null}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

// A real link to one source Vettan used. Titles weren't recorded, so it shows host and path.
export function SourceCard({
  source,
  cited,
  className,
  tabIndex,
}: {
  source: DemoSource
  cited?: number
  className?: string
  tabIndex?: number
}) {
  const { active } = useSourceState(source.rank)
  const path = urlPath(source.url)

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabIndex}
      title={source.url}
      data-source-rank={source.rank}
      className={cn(
        "grid min-h-[56px] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-v-card border px-3.5 py-2.5 no-underline transition-[border-color,background-color,box-shadow] duration-150",
        active ? "border-v-accent-line-2 bg-v-wash shadow-v-lift" : "border-v-line-2 bg-v-surface-1 hover:border-v-line-hover",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="row-span-2 flex size-8 items-center justify-center rounded-v-control bg-v-wash-2 font-v-mono text-[13px] text-v-violet-300"
      >
        {monogram(source.domain)}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[14px] font-semibold text-v-ink-1">{source.domain}</span>
        {cited ? <span className="shrink-0 font-v-mono text-[11.5px] text-v-ink-4">cited {cited}×</span> : null}
      </span>
      <span className="truncate font-v-mono text-[12px] text-v-ink-4">{path}</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

export { citedTimes }
