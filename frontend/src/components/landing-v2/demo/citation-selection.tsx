"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Citation } from "@/lib/research-demo"

interface Selection {
  hovered: number | null
  selected: number | null
  preview: (rank: number | null) => void
  toggle: (rank: number, el: HTMLElement) => void
  lastCitation: () => HTMLElement | null
}

const NOOP: Selection = {
  hovered: null,
  selected: null,
  preview: () => {},
  toggle: () => {},
  lastCitation: () => null,
}

const SelectionContext = createContext<Selection>(NOOP)

// One scope per section (hero, story, report). Hover and focus preview a source; click,
// Enter, Space or tap selects it, which is what touch and keyboard readers rely on.
export function CitationScope({
  children,
  onSelect,
}: {
  children: React.ReactNode
  onSelect?: (rank: number) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const last = useRef<HTMLElement | null>(null)

  const toggle = useCallback(
    (rank: number, el: HTMLElement) => {
      const next = selected === rank ? null : rank
      setSelected(next)
      if (next === null) return
      last.current = el
      // After the selection has rendered, so the source card shows its new state.
      requestAnimationFrame(() => onSelect?.(rank))
    },
    [onSelect, selected]
  )

  const lastCitation = useCallback(() => last.current, [])
  const value = useMemo<Selection>(
    () => ({ hovered, selected, preview: setHovered, toggle, lastCitation }),
    [hovered, selected, toggle, lastCitation]
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useCitationSelection(): Selection {
  return useContext(SelectionContext)
}

export function useSourceState(rank: number): { active: boolean; selected: boolean } {
  const { hovered, selected } = useCitationSelection()
  return { active: hovered === rank || selected === rank, selected: selected === rank }
}

// An inline citation from the report. Selecting it shows a check badge that sits outside the
// layout, so the pill and the paragraph never move.
export function CitationButton({ citation }: { citation: Citation }) {
  const { preview, toggle } = useCitationSelection()
  const { active, selected } = useSourceState(citation.sourceRank)
  const rank = citation.sourceRank

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Citation: ${citation.displayLabel}. Show this source`}
      title={citation.url}
      data-citation={citation.index}
      data-source-rank={rank}
      onClick={(e) => toggle(rank, e.currentTarget)}
      onMouseEnter={() => preview(rank)}
      onMouseLeave={() => preview(null)}
      onFocus={() => preview(rank)}
      onBlur={() => preview(null)}
      className={cn(
        "relative mx-0.5 inline-flex items-center rounded-v-chip border px-1.5 align-[1px] text-[11.5px] leading-[1.6] transition-colors duration-150",
        // A fingertip-sized tap area on touch screens; it never changes the layout.
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:content-['']",
        active
          ? "border-v-accent-line-2 bg-v-wash-2 text-v-violet-200"
          : "border-v-accent-line bg-v-wash text-v-violet-300 hover:text-v-violet-200"
      )}
    >
      <span className="font-v-mono">{citation.displayLabel}</span>
      {selected ? (
        <span
          aria-hidden="true"
          data-citation-check
          className="absolute -right-[5px] -top-[5px] flex size-[13px] items-center justify-center rounded-full bg-v-violet-400 text-v-on-violet"
        >
          <Check className="size-[9px]" strokeWidth={3.5} />
        </span>
      ) : null}
    </button>
  )
}
