"use client"

import { useRef } from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { GITHUB_URL } from "@/components/legal/legal-page"
import { LEGAL_DOCUMENTS, LEGAL_ORDER } from "@/content/legal/meta"
import { ClosingField } from "@/lib/constellation/closing-field"
import { TIER_SCALE } from "@/lib/constellation/particles"
import { ResearchField } from "../landing-v2/hero/research-field"
import { useReducedMotion } from "../landing-v2/use-reduced-motion"
import { useCanvasLoop } from "./use-constellation"

export function ClosingCtaV3() {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { ready } = useCanvasLoop(canvasRef, {
    make: (canvas, tier) => new ClosingField(canvas, TIER_SCALE[tier]),
    frame: (field, clock) => field.draw(clock),
    reduced,
    stillClock: 0,
  })

  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden border-t border-v-line-1">
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full transition-opacity duration-700" style={{ opacity: ready ? 1 : 0 }} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[54%] h-[500px] w-[min(900px,100%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(124_111_240/0.28),rgb(124_111_240/0))]"
      />
      <div className="relative mx-auto flex max-w-[760px] flex-col items-center px-4 pb-28 pt-24 text-center sm:px-6 md:pt-[118px]">
        <h2
          id="cta-title"
          className="bg-[linear-gradient(180deg,#ffffff_30%,#c9c2ff_120%)] bg-clip-text text-[44px] font-extrabold leading-none tracking-[-0.05em] text-transparent md:text-[72px]"
        >
          Stop reading ten tabs.
        </h2>
        <p className="mt-[18px] text-[17px] leading-[1.55] text-[#b4b4c0] md:text-[19px]">Ask Vettan something you actually need answered.</p>
        <div className="mt-[30px] flex w-full justify-center">
          <ResearchField appearance="observatory" />
        </div>
      </div>
    </section>
  )
}

const FOOT_LINK = "inline-flex min-h-11 items-center text-[14px] text-[#b4b4c0] no-underline transition-colors hover:text-v-ink-1"
const FOOT_HEAD = "mb-1.5 font-v-mono text-[11px] uppercase tracking-[0.08em] text-v-ink-4"

export function FooterV3() {
  return (
    <footer className="relative overflow-hidden border-t border-v-line-1">
      <div className="mx-auto grid max-w-[1312px] grid-cols-2 gap-x-6 gap-y-10 px-4 pb-48 pt-14 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] md:gap-10 md:pb-64 lg:px-12">
        <div className="col-span-2 flex flex-col gap-3 md:col-span-1">
          <a href="#start" className="self-start text-[20px] font-bold tracking-[-0.015em] text-v-ink-1 no-underline">
            Vettan
          </a>
          <p className="text-[15px] text-v-ink-2">Think deeper. Discover faster.</p>
          <p className="max-w-[320px] text-[13.5px] leading-[1.6] text-v-ink-3">Web research with citations you can check. Open source under the MIT license.</p>
        </div>
        <nav aria-label="Product" className="flex flex-col">
          <p className={FOOT_HEAD}>Product</p>
          <a href="#how" className={FOOT_LINK}>
            How it works
          </a>
          <a href="#example" className={FOOT_LINK}>
            Example report
          </a>
          <a href="#features" className={FOOT_LINK}>
            Features
          </a>
          <Link href="/sign-in" className={FOOT_LINK}>
            Sign in
          </Link>
        </nav>
        <nav aria-label="Legal" className="flex flex-col">
          <p className={FOOT_HEAD}>Legal</p>
          {LEGAL_ORDER.map((slug) => (
            <Link key={slug} href={`/${slug}`} className={FOOT_LINK}>
              {LEGAL_DOCUMENTS[slug].shortTitle}
            </Link>
          ))}
        </nav>
        <nav aria-label="Open source" className="flex flex-col">
          <p className={FOOT_HEAD}>Open source</p>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={`${FOOT_LINK} gap-1`}>
            GitHub
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <span className="inline-flex min-h-11 items-center text-[14px] text-v-ink-4">MIT license</span>
        </nav>
      </div>
      <p
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-6 left-3 select-none whitespace-nowrap bg-[linear-gradient(180deg,rgb(182_172_255/0.22),rgb(182_172_255/0.02)_85%)] bg-clip-text text-[120px] font-black leading-none tracking-[-0.06em] text-transparent sm:left-6 md:-bottom-9 md:text-[250px] lg:left-12"
      >
        Vettan
      </p>
    </footer>
  )
}
