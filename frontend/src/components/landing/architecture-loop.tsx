"use client"

import { useEffect, useRef, useState } from "react"
import { Reveal } from "./reveal"

interface Step {
  label: string
  agent: string
  description: string
}

const steps: Step[] = [
  {
    label: "Thought",
    agent: "Planner",
    description: "Breaks the question into sub-goals and decides what evidence is still missing.",
  },
  {
    label: "Action",
    agent: "Researcher",
    description: "Runs targeted web searches, opens sources, extracts the relevant passages.",
  },
  {
    label: "Observation",
    agent: "Critic",
    description: "Checks new evidence against existing claims — flags contradictions or weak sources.",
  },
  {
    label: "Synthesis",
    agent: "Synthesizer",
    description: "Merges verified findings into a cited answer — or loops back if evidence is thin.",
  },
]

const reactLoopSpeed = 2500

export function ArchitectureLoop() {
  const [activeStep, setActiveStep] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = () => {
    if (intervalRef.current) return
    intervalRef.current = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length)
    }, reactLoopSpeed)
  }

  const stop = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  useEffect(() => {
    start()
    return stop
  }, [])

  return (
    <Reveal id="architecture" className="relative z-10 mx-auto max-w-[1100px] px-12 py-[110px]">
      <h2 className="text-center text-[36px] font-bold tracking-[-0.01em] text-[#EDEDF2]">
        Inside the loop
      </h2>
      <p className="mx-auto mt-4 max-w-[620px] text-center text-[17px] leading-[1.55] text-[#A6A6B3]">
        Every query runs Thought → Action → Observation → Synthesis until the system is
        confident — a negotiation between agents, not a single pass.
      </p>

      <div
        className="mt-14 grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:gap-0"
        onMouseEnter={stop}
        onMouseLeave={start}
      >
        {steps.map((step, index) => (
          <div key={step.label} className="contents">
            <div
              className="rounded-[14px] border p-5 transition-all duration-[400ms] ease-out md:mx-2"
              style={
                index === activeStep
                  ? {
                      borderColor: "rgba(124,111,240,0.55)",
                      backgroundColor: "rgba(124,111,240,0.1)",
                      transform: "scale(1.03)",
                    }
                  : {
                      borderColor: "rgba(255,255,255,0.08)",
                      backgroundColor: "rgba(255,255,255,0.02)",
                    }
              }
            >
              <div
                className="text-[15px] font-semibold transition-colors duration-[400ms]"
                style={{ color: index === activeStep ? "#C9C2FF" : "#EDEDF2" }}
              >
                {step.label}
              </div>
              <div className="mt-1 font-[family-name:var(--font-geist-mono)] text-[12px] uppercase tracking-[0.08em] text-[#7C6FF0]">
                {step.agent}
              </div>
              <p className="mt-3 text-[13.5px] leading-[1.5] text-[#9B9BA8]">
                {step.description}
              </p>
            </div>
            {index < steps.length - 1 && (
              <div className="flex items-center justify-center text-[20px] text-[#3A3A44]">
                →
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-[13px] text-[#6B6B78]">
        ↩ loops back to Thought when evidence is still insufficient
      </p>
    </Reveal>
  )
}
