"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useReducedMotion } from "../use-reduced-motion"
import { EvidenceStage } from "./evidence-stage"
import { MOMENTS } from "./moments"
import { StepRail } from "./step-rail"
import { StoryStep } from "./story-step"

// The moment whose step has crossed 55% of the viewport height, latest first.
export const ACTIVE_LINE = 0.55
export function activeStep(stepTops: number[], viewportHeight: number): number {
  let active = 0
  stepTops.forEach((top, i) => {
    if (top < viewportHeight * ACTIVE_LINE) active = i
  })
  return active
}

// Native scrolling only: the steps scroll normally and the stage beside them is sticky.
export function ResearchStory({ stepVh }: { stepVh: number }) {
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])
  const [active, setActive] = useState(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const steps = stepRefs.current
      if (!steps[0]?.offsetParent) return
      const next = activeStep(
        steps.map((el) => (el ? el.getBoundingClientRect().top : Infinity)),
        window.innerHeight
      )
      setActive((prev) => (prev === next ? prev : next))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  const goTo = useCallback(
    (index: number) => {
      setActive(index)
      stepRefs.current[index]?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" })
    },
    [reduced]
  )

  return (
    <section id="how" aria-labelledby="how-title" className="relative border-t border-v-line-1">
      <div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-12">
        <div className="max-w-[620px]">
          <h2 id="how-title" className="text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-v-ink-1 md:text-[36px]">
            How Vettan works
          </h2>
          <p className="mt-3.5 text-[17px] leading-[1.55] text-v-ink-2">Follow one real question from start to finished report.</p>
        </div>

        <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-16 lg:motion-reduce:block">
          <ol>
            {MOMENTS.map((moment, i) => (
              <StoryStep
                key={moment.id}
                ref={(el) => {
                  stepRefs.current[i] = el
                }}
                moment={moment}
                index={i}
                active={active === i}
                stepVh={stepVh}
              />
            ))}
          </ol>

          <div className="hidden lg:block lg:motion-reduce:hidden">
            <div className="sticky top-24 flex flex-col gap-6">
              <StepRail active={active} onSelect={goTo} />
              <EvidenceStage moment={active} />
              <p className="sr-only" aria-live="polite">
                Moment {active + 1} of {MOMENTS.length}: {MOMENTS[active].title}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
