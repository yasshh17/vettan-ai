"use client"

import { cn } from "@/lib/utils"
import { MOMENTS } from "./moments"

export function StepRail({ active, onSelect }: { active: number; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="Story moments">
      <ol className="flex gap-1">
        {MOMENTS.map((moment, i) => (
          <li key={moment.id} className="flex-1">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={active === i ? "step" : undefined}
              aria-label={`${i + 1}. ${moment.label}`}
              className={cn(
                "flex min-h-11 w-full flex-col justify-center gap-1.5 px-1 py-1.5 text-left",
                active === i ? "text-v-ink-1" : "text-v-ink-4 hover:text-v-ink-2"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-0.5 w-full rounded-full transition-colors duration-300",
                  i <= active ? "bg-v-violet-400" : "bg-v-line-3"
                )}
              />
              <span aria-hidden="true" className="font-v-mono text-[11px]">
                {i + 1} {moment.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
