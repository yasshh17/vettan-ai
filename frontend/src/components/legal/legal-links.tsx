import Link from "next/link"
import { Fragment } from "react"
import { LEGAL_DOCUMENTS, LEGAL_ORDER } from "@/content/legal/meta"

// Where leaving would lose a half-filled form or a running answer.
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const

const INLINE =
  "text-[#B6ACFF] underline decoration-[rgba(182,172,255,0.35)] underline-offset-2 hover:text-[#D6D0FF]"

export function LegalLinkRow({
  className = "",
  linkClassName = "text-[#8A8A96] transition-colors hover:text-[#EDEDF2]",
  newTab = false,
}: {
  className?: string
  linkClassName?: string
  newTab?: boolean
}) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {LEGAL_ORDER.map((slug, i) => (
        <Fragment key={slug}>
          {i > 0 && (
            <span aria-hidden="true" className="text-[#3A3A44]">
              ·
            </span>
          )}
          <Link href={`/${slug}`} className={linkClassName} {...(newTab ? NEW_TAB : {})}>
            {LEGAL_DOCUMENTS[slug].shortTitle}
          </Link>
        </Fragment>
      ))}
    </nav>
  )
}

// "Acknowledge" the Privacy Policy, not "agree": it's a notice, not a contract.
export function SignUpConsent({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-[12.5px] leading-[1.6] text-[#9B9BA8] ${className}`}>
      By creating an account, you confirm you&apos;re 18 or older, agree to our{" "}
      <Link href="/terms" className={INLINE} {...NEW_TAB}>
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link href="/usage-policy" className={INLINE} {...NEW_TAB}>
        Usage Policy
      </Link>
      , and acknowledge our{" "}
      <Link href="/privacy" className={INLINE} {...NEW_TAB}>
        Privacy Policy
      </Link>
      .
    </p>
  )
}
