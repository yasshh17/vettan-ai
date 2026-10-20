"use client"

import { cn } from "@/lib/utils"
import type { Block, Span } from "@/lib/research-demo"
import { CitationButton } from "./citation-selection"

export function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === "text") return <span key={i}>{s.text}</span>
        if (s.kind === "strong")
          return (
            <strong key={i} className="font-semibold text-v-ink-1">
              {s.text}
            </strong>
          )
        if (s.kind === "cite") return <CitationButton key={i} citation={s.citation} />
        return (
          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-v-violet-300 underline">
            {s.text}
          </a>
        )
      })}
    </>
  )
}

// Renders the recorded report exactly as generated; citation pills label each source by its host.
export function ReportView({ blocks, className }: { blocks: Block[]; className?: string }) {
  return (
    <div className={cn("flex max-w-[68ch] flex-col gap-4 text-[16px] leading-[1.7] text-v-ink-body", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "title")
          return (
            <h4 key={i} className="text-[19px] font-semibold leading-[1.4] text-v-ink-1">
              {b.text}
            </h4>
          )
        if (b.kind === "heading")
          return (
            <h4 key={i} className="mt-2.5 text-[16px] font-semibold leading-[1.4] text-v-ink-1">
              {b.text}
            </h4>
          )
        if (b.kind === "list")
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-v-ink-4">
              {b.items.map((item, j) => (
                <li key={j}>
                  <Spans spans={item} />
                </li>
              ))}
            </ul>
          )
        return (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        )
      })}
    </div>
  )
}
