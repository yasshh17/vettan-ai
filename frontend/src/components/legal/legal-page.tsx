import Link from "next/link"
import { ArrowRight, ShieldCheck } from "lucide-react"
import { LEGAL_DOCUMENTS, LEGAL_ORDER, LEGAL_VALUES } from "@/content/legal/meta"
import type { LoadedLegalDoc } from "@/lib/legal"
import { LegalMarkdown } from "@/components/legal/legal-markdown"
import { BackToTop, LegalToc, LegalTocDisclosure, type TocItem } from "@/components/legal/legal-toc"
import { PrintButton } from "@/components/legal/print-button"

const MONO = "font-[family-name:var(--font-geist-mono)]"
const GUTTER = "px-4 sm:px-8 lg:px-12"
export const GITHUB_URL = "https://github.com/yasshh17/vettan-ai"

export function LegalPage({ doc }: { doc: LoadedLegalDoc }) {
  const toc: TocItem[] = [
    { id: "key-points", label: "Key points" },
    ...doc.sections.map((s) => ({
      id: s.id,
      label: s.number ? `${Number(s.number)}. ${s.title}` : s.title,
    })),
  ]
  const next = LEGAL_DOCUMENTS[LEGAL_ORDER[(LEGAL_ORDER.indexOf(doc.slug) + 1) % LEGAL_ORDER.length]]

  return (
    <div
      id="top"
      className="legal-doc min-h-screen bg-[#09090c] font-[family-name:var(--font-geist-sans)] text-[#C4C4CE] antialiased"
    >
      <header className="border-b border-white/[0.06] print:hidden">
        <nav
          aria-label="Primary"
          className={`mx-auto flex max-w-[1200px] items-center justify-between gap-4 py-[18px] ${GUTTER}`}
        >
          <Link href="/" className="text-[19px] font-bold tracking-[-0.01em] text-[#EDEDF2]">
            Vettan
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/sign-in"
              className="hidden px-3 py-2.5 text-sm text-[#9B9BA8] transition-colors hover:text-[#EDEDF2] sm:inline"
            >
              Sign in
            </Link>
            <Link
              href="/app"
              className="inline-flex h-10 items-center rounded-[10px] bg-[#9C90FF] px-4 text-sm font-semibold text-[#09090c] transition-colors hover:bg-[#B6ACFF]"
            >
              Open Vettan
            </Link>
          </div>
        </nav>
      </header>

      <section className={`mx-auto max-w-[1200px] pt-10 sm:pt-[72px] ${GUTTER}`}>
        <p className={`${MONO} text-xs uppercase tracking-[0.14em] text-[#9C90FF]`}>Legal</p>
        <h1 className="mt-3.5 text-[36px] font-bold leading-[1.05] tracking-[-0.025em] text-[#EDEDF2] sm:text-[52px]">
          {doc.title}
        </h1>
        <p className="mt-4 max-w-[620px] text-base leading-[1.6] text-[#9B9BA8] sm:text-lg">
          {doc.description}
        </p>
        <div className={`${MONO} mt-6 flex flex-wrap items-center gap-2.5 text-[12.5px] text-[#9B9BA8]`}>
          <span className="inline-flex h-[30px] items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3">
            <span className="h-1.5 w-1.5 rounded-full bg-[#9C90FF]" aria-hidden="true" />
            Last updated {doc.lastUpdated}
          </span>
          <span className="inline-flex h-[30px] items-center rounded-full border border-white/[0.08] px-3">
            Version {doc.version}
          </span>
          <span className="inline-flex h-[30px] items-center px-1">{doc.readingMinutes} min read</span>
        </div>

        <nav
          aria-label="Legal documents"
          className="mt-10 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-1 print:hidden"
        >
          {LEGAL_ORDER.map((slug) => {
            const current = slug === doc.slug
            return (
              <Link
                key={slug}
                href={`/${slug}`}
                aria-current={current ? "page" : undefined}
                className={`whitespace-nowrap rounded-[9px] px-4 py-[9px] text-sm font-medium transition-colors ${
                  current
                    ? "bg-[rgba(156,144,255,0.14)] text-[#EDEDF2] shadow-[inset_0_0_0_1px_rgba(156,144,255,0.28)]"
                    : "text-[#9B9BA8] hover:bg-white/[0.04] hover:text-[#EDEDF2]"
                }`}
              >
                <span className="sm:hidden">{LEGAL_DOCUMENTS[slug].shortTitle}</span>
                <span className="hidden sm:inline">{LEGAL_DOCUMENTS[slug].title}</span>
              </Link>
            )
          })}
        </nav>
      </section>

      <div
        className={`mx-auto max-w-[1200px] pb-24 pt-10 sm:pt-14 lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-[72px] ${GUTTER}`}
      >
        <aside className="hidden print:hidden lg:sticky lg:top-8 lg:block lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto">
          <LegalToc items={toc} />
          <div className="mt-8 rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-[18px]">
            <p className="text-sm font-semibold text-[#EDEDF2]">Questions?</p>
            <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[#9B9BA8]">
              Email{" "}
              <a
                href={`mailto:${LEGAL_VALUES.CONTACT_EMAIL}`}
                className="text-[#B6ACFF] underline decoration-[rgba(182,172,255,0.35)] underline-offset-[3px] hover:text-[#D6D0FF]"
              >
                {LEGAL_VALUES.CONTACT_EMAIL}
              </a>
            </p>
            <PrintButton />
          </div>
        </aside>

        <article className="min-w-0 max-w-[700px] text-[16.5px] leading-[1.75]">
          <div className="print:hidden">
            <LegalTocDisclosure items={toc} />
          </div>

          <LegalMarkdown>{doc.intro}</LegalMarkdown>

          <section
            id="key-points"
            aria-labelledby="key-points-title"
            className="mb-2 mt-10 scroll-mt-24 rounded-[18px] border border-[rgba(156,144,255,0.2)] bg-[rgba(156,144,255,0.05)] px-5 pb-5 pt-6 sm:px-7 sm:pt-7"
          >
            <h2
              id="key-points-title"
              className="mb-4 flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.01em] text-[#EDEDF2]"
            >
              <ShieldCheck className="h-[18px] w-[18px] text-[#9C90FF]" aria-hidden="true" />
              Key points
            </h2>
            <LegalMarkdown variant="keyPoints">{doc.keyPoints}</LegalMarkdown>
          </section>

          <LegalMarkdown>{doc.body}</LegalMarkdown>

          <div className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-[22px] print:hidden">
            <div>
              <p className={`${MONO} text-xs uppercase tracking-[0.1em] text-[#8A8A96]`}>Next</p>
              <p className="mt-1 text-[17px] font-semibold text-[#EDEDF2]">{next.title}</p>
            </div>
            <Link
              href={`/${next.slug}`}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[rgba(156,144,255,0.35)] px-[18px] text-sm font-medium text-[#D6D0FF] transition-colors hover:bg-[rgba(156,144,255,0.08)]"
            >
              Read it
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </article>
      </div>

      <footer className="border-t border-white/[0.06] print:hidden">
        <div
          className={`mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 py-7 text-[13.5px] text-[#8A8A96] ${GUTTER}`}
        >
          <p>© {new Date().getFullYear()} {LEGAL_VALUES.OPERATOR_NAME} · Vettan is a demo project</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-[22px]">
            {LEGAL_ORDER.map((slug) => (
              <Link key={slug} href={`/${slug}`} className="transition-colors hover:text-[#EDEDF2]">
                {LEGAL_DOCUMENTS[slug].shortTitle}
              </Link>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[#EDEDF2]"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>

      <BackToTop />
    </div>
  )
}
