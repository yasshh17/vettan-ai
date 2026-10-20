import type { Metadata } from "next"
import { Nav } from "@/components/landing/nav"
import { BackgroundLayer } from "@/components/landing/background-layer"
import { Hero } from "@/components/landing/hero"
import { ArchitectureLoop } from "@/components/landing/architecture-loop"
import { ProofDemo } from "@/components/landing/proof-demo"
import { ClosingCta } from "@/components/landing/closing-cta"
import { Footer } from "@/components/landing/footer"

// The homepage before Landing v62, kept as it was so it can be restored by pointing
// src/app/page.tsx back at it. Not routed anywhere. Its copy makes claims the pipeline doesn't
// back (ReAct, multi-agent, verification), which is why it was replaced.
export const LEGACY_HOME_METADATA: Metadata = {
  title: "Vettan — ReAct-based multi-agent research",
  description:
    "A ReAct-driven multi-agent system that plans, searches, verifies, and synthesizes — so you get a considered answer instead of a list of links to sort through yourself.",
}

export function LegacyHome() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#09090c] font-[family-name:var(--font-geist-sans)] text-[#EDEDF2]">
      <BackgroundLayer />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <ArchitectureLoop />
        <ProofDemo />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  )
}
