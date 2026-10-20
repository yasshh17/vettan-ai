import Link from "next/link"
import { GITHUB_URL } from "@/components/legal/legal-page"
import { LEGAL_DOCUMENTS, LEGAL_ORDER } from "@/content/legal/meta"
import { ResearchField } from "./hero/research-field"

const FOOT_LINK = "inline-flex min-h-11 items-center text-v-ink-3 no-underline transition-colors hover:text-v-ink-1"

export function ClosingCta() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden border-t border-v-line-1">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-340px] left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(ellipse at center, rgba(124,111,240,0.14), rgba(124,111,240,0) 65%)" }}
      />
      <div className="relative mx-auto flex max-w-[720px] flex-col items-center px-4 py-28 text-center sm:px-6">
        <h2 id="cta-title" className="text-[28px] font-bold leading-[1.12] tracking-[-0.02em] text-v-ink-1 md:text-[36px]">
          Stop reading ten tabs.
        </h2>
        <p className="mb-7 mt-3.5 text-[17px] leading-[1.55] text-v-ink-2">Ask Vettan something you actually need answered.</p>
        <div className="flex w-full justify-center text-left">
          <ResearchField />
        </div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="border-t border-v-line-1">
      <div className="mx-auto flex max-w-[1240px] flex-col items-start gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <p className="text-[19px] font-bold tracking-[-0.01em] text-v-ink-1">Vettan</p>
          <p className="mt-1 text-[14px] text-v-ink-3">Think deeper. Discover faster.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 text-[13px]">
          {LEGAL_ORDER.map((slug) => (
            <Link key={slug} href={`/${slug}`} className={FOOT_LINK}>
              {LEGAL_DOCUMENTS[slug].shortTitle}
            </Link>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={FOOT_LINK}>
            GitHub<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
      </div>
    </footer>
  )
}
