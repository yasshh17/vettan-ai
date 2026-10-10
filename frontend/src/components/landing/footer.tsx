import { LegalLinkRow } from "@/components/legal/legal-links"
import { GITHUB_URL } from "@/components/legal/legal-page"

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-[rgba(255,255,255,0.06)] px-6 py-10 sm:px-12">
      <div className="flex flex-col items-center justify-between gap-4 text-[13px] sm:flex-row">
        <p className="text-[#8A8A96]">Vettan — ReAct-based multi-agent research.</p>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <LegalLinkRow />
          <span aria-hidden="true" className="text-[#3A3A44]">
            ·
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8A8A96] transition-colors hover:text-[#EDEDF2]"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}
