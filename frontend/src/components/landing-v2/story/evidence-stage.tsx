"use client"

import { useMemo } from "react"
import { Check } from "lucide-react"
import { DEMO, DEMO_CITATIONS, HERO_HEADING, STAGE_RESULT_EXCERPT, citationCounts, monogram, tokenizeReport } from "@/lib/research-demo"
import { CitationScope, useSourceState } from "../demo/citation-selection"
import { Spans } from "../demo/report-view"
import { SourceCard } from "../demo/source-card"
import { isShown, poseStyle, type StageLayer } from "./stage-poses"

// One 520×480 scene from the v62 canvas. Every layer takes its pose for the active moment
// from stage-poses; only transform and opacity animate.
const counts = citationCounts(DEMO_CITATIONS)
const W = 520
const H = 480
const BRANCHES = [132, 194, 256, 318].map((y) => `M 280 ${y} C 320 ${y}, 310 250, 340 250`)
const THREADS = [
  [141, 185],
  [187, 209],
  [233, 233],
  [279, 257],
  [325, 281],
].map(([from, to]) => `M 314 ${from} C 280 ${from}, 275 ${to}, 241 ${to}`)
const SKELETON = [92, 86, 95, 70, 88, 60]

function Layer({
  layer,
  moment,
  className,
  style,
  children,
}: {
  layer: StageLayer
  moment: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  // A hidden layer keeps its place for the transition but leaves the tab order and a11y tree.
  const shown = isShown(layer, moment)
  return (
    <div
      inert={!shown}
      aria-hidden={!shown || undefined}
      data-stage-layer={layer}
      className={className}
      style={{ ...style, ...poseStyle(layer, moment) }}
    >
      {children}
    </div>
  )
}

function ResultChip({ rank }: { rank: number }) {
  const source = DEMO.sources[rank - 1]
  const { active, selected } = useSourceState(rank)
  const n = counts.get(rank) ?? 0
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      data-source-rank={rank}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-v-mono text-[11px] no-underline transition-colors duration-150 " +
        (active
          ? "border-v-accent-line-2 bg-v-wash text-v-violet-200"
          : "border-v-line-2 text-v-ink-3 hover:border-v-accent-line-2 hover:text-v-violet-200")
      }
    >
      {/* Fixed 11px slot: selection swaps the letter for a check, so the chip never resizes. */}
      <span aria-hidden="true" className="inline-flex w-[11px] flex-none justify-center text-v-violet-300">
        {selected ? <Check className="size-[11px]" strokeWidth={2.5} /> : monogram(source.domain)}
      </span>
      {source.domain} ×{n}
      {selected ? <span className="sr-only">, selected</span> : null}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

export function EvidenceStage({ moment }: { moment: number }) {
  const excerpt = useMemo(() => tokenizeReport(STAGE_RESULT_EXCERPT, DEMO.sources)[0], [])

  return (
    <CitationScope>
      <div data-stage-moment={moment} className="relative mx-auto h-[480px] w-[520px]" style={{ perspective: 1200 }}>
        <Layer
          layer="q"
          moment={moment}
          className="absolute left-[40px] top-0 w-[440px] origin-top rounded-v-card border border-v-line-3 bg-v-panel px-4 py-3.5 shadow-v-lift"
        >
          <p className="font-v-mono text-[11px] text-v-ink-4">Question</p>
          <p className="mt-1 text-[16px] font-medium leading-[1.4] text-v-ink-1">{DEMO.query}</p>
        </Layer>

        {/* Plan and Search share these four cards: they move, fill and finish, never re-listed. */}
        {DEMO.subQueries.map((q, i) => (
          <Layer
            key={q}
            layer={`sub${i}` as StageLayer}
            moment={moment}
            className="absolute left-0 top-0 flex w-[280px] items-center gap-2.5 overflow-hidden rounded-v-control border border-v-line-2 bg-v-panel px-3 py-2.5"
          >
            <span className="font-v-mono text-[11px] text-v-ink-4">{i + 1}</span>
            <span className="min-w-0 flex-1 text-[13px] leading-[1.35] text-v-ink-2">{q}</span>
            <span style={poseStyle(`subchk${i}` as StageLayer, moment)}>
              <span className="inline-flex items-center gap-[3px] text-[11.5px] font-semibold text-v-violet-300">
                <Check aria-hidden="true" className="size-[13px]" strokeWidth={2.5} />
                Done
              </span>
            </span>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-v-violet-400"
              style={poseStyle(`subbar${i}` as StageLayer, moment)}
            />
          </Layer>
        ))}

        <svg aria-hidden="true" width={W} height={H} className="pointer-events-none absolute left-0 top-0">
          {BRANCHES.map((d, i) => (
            <path key={d} d={d} fill="none" stroke="var(--color-v-violet-400)" strokeWidth={1.25} style={poseStyle(`br${i}` as StageLayer, moment)} />
          ))}
        </svg>

        <Layer
          layer="band"
          moment={moment}
          className="absolute left-[340px] top-[206px] w-[180px] rounded-v-card border border-v-accent-line bg-v-wash px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold text-v-violet-200">Parallel search</p>
          <p className="mt-0.5 text-[12.5px] text-v-ink-2">The same {DEMO.search.planned} searches, at once</p>
          <p
            className="mt-1.5 flex items-center gap-1 text-[12.5px] font-semibold text-v-violet-300"
            style={poseStyle("bandDone", moment)}
          >
            <Check aria-hidden="true" className="size-[13px]" strokeWidth={2.5} />
            {DEMO.search.succeeded} of {DEMO.search.planned} succeeded
          </p>
        </Layer>

        {DEMO.sources.map((s, i) => (
          <Layer key={s.url} layer={`src${i}` as StageLayer} moment={moment} className="absolute left-0 top-0 w-[236px]">
            <SourceCard source={s} cited={counts.get(s.rank)} className="bg-v-panel" />
          </Layer>
        ))}

        <svg aria-hidden="true" width={W} height={H} className="pointer-events-none absolute left-0 top-0">
          {THREADS.map((d, i) => (
            <path key={d} d={d} fill="none" stroke="var(--color-v-violet-300)" strokeWidth={1} style={poseStyle(`th${i}` as StageLayer, moment)} />
          ))}
        </svg>

        {DEMO.sources.map((s, i) => (
          <div
            key={s.url}
            aria-hidden="true"
            className="absolute left-[314px] flex items-center gap-2"
            style={{ top: 125 + i * 46, ...poseStyle(`mono${i}` as StageLayer, moment) }}
          >
            <span className="flex size-8 flex-none items-center justify-center rounded-full border border-v-line-3 bg-v-panel font-v-mono text-[12px] text-v-violet-300">
              {monogram(s.domain)}
            </span>
            <span className="whitespace-nowrap font-v-mono text-[11px] text-v-ink-3">{s.domain}</span>
          </div>
        ))}

        <Layer
          layer="rep"
          moment={moment}
          className="absolute left-0 top-0 w-[480px] origin-top-left rounded-v-panel border border-v-accent-line bg-v-panel p-5 shadow-v-panel"
        >
          <div aria-hidden="true" className="absolute inset-x-5 top-5 flex flex-col gap-3" style={poseStyle("repSk", moment)}>
            <div className="h-4 w-3/4 rounded bg-v-line-3" />
            {SKELETON.map((w) => (
              <div key={w} className="h-3 rounded bg-v-line-2" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div style={poseStyle("repCt", moment)}>
            <p className="font-v-mono text-[11px] text-v-violet-300">Report</p>
            <p className="mb-2 mt-1 text-[15px] font-semibold text-v-ink-1">{HERO_HEADING}</p>
            <p className="text-[13.5px] leading-[1.65] text-v-ink-body">
              {excerpt?.kind === "paragraph" ? <Spans spans={excerpt.spans} /> : null}
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-v-line-2 pt-3">
              {DEMO.sources.map((s) => (
                <ResultChip key={s.url} rank={s.rank} />
              ))}
            </div>
            <a href="#example" className="mt-3 inline-block text-[13px] font-medium text-v-violet-300 underline-offset-4 hover:underline">
              Read the full report
            </a>
          </div>
        </Layer>
      </div>
    </CitationScope>
  )
}
