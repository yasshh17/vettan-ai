"use client"

import { forwardRef } from "react"
import { cn } from "@/lib/utils"
import type { Moment } from "./moments"
import { StaticFigure } from "./static-figures"

interface StoryStepProps {
  moment: Moment
  index: number
  active: boolean
  stepVh: number
}

// One moment of the story. On wide screens it sets the scroll distance and dims while
// inactive; below that, or with reduced motion, it carries its own figure at full contrast.
export const StoryStep = forwardRef<HTMLLIElement, StoryStepProps>(function StoryStep(
  { moment, index, active, stepVh },
  ref
) {
  return (
    <li
      ref={ref}
      id={`moment-${index + 1}`}
      data-step-vh={stepVh}
      style={{ "--step-h": `${stepVh}vh` } as React.CSSProperties}
      className="flex flex-col justify-center py-5 md:py-7 lg:motion-safe:min-h-[var(--step-h)]"
    >
      <p className="font-v-mono text-[12px] text-v-violet-300">
        {String(index + 1).padStart(2, "0")} {moment.label}
      </p>
      <h3
        className={cn(
          "mt-2 text-[22px] font-semibold leading-[1.25] tracking-[-0.01em] text-v-ink-1 transition-colors duration-300 md:text-[26px]",
          !active && "lg:motion-safe:text-v-ink-3"
        )}
      >
        {moment.title}
      </h3>
      <p
        className={cn(
          "mt-2.5 max-w-[440px] text-[16px] leading-[1.6] text-v-ink-2 transition-colors duration-300",
          !active && "lg:motion-safe:text-v-ink-4"
        )}
      >
        {moment.body}
      </p>
      <div className="mt-5 lg:motion-safe:hidden">
        <StaticFigure index={index} />
      </div>
    </li>
  )
})
