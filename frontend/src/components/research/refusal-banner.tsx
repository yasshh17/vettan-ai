import Link from "next/link"
import { Fragment } from "react"
import { HeartHandshake, ShieldAlert } from "lucide-react"

const HELPLINE = "findahelpline.com"

export function isSupportMessage(message: string): boolean {
  return message.includes(HELPLINE)
}

function linkHelpline(message: string, linkClassName: string) {
  const parts = message.split(HELPLINE)
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <a
          href={`https://${HELPLINE}`}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
        >
          {HELPLINE}
        </a>
      )}
    </Fragment>
  ))
}

// Amber rather than red: nothing went wrong.
export function RefusalBanner({ message }: { message: string }) {
  if (isSupportMessage(message)) {
    const link =
      "font-medium text-[#D6D0FF] underline decoration-[rgba(214,208,255,0.45)] underline-offset-2 hover:text-white"
    return (
      <div
        role="alert"
        className="mx-auto mb-8 flex max-w-3xl gap-3.5 rounded-[14px] border border-[rgba(156,144,255,0.28)] bg-[rgba(156,144,255,0.07)] px-[18px] py-4"
      >
        <HeartHandshake className="mt-0.5 h-5 w-5 flex-none text-[#9C90FF]" aria-hidden="true" />
        <p className="text-[14.5px] leading-[1.6] text-[#E4E0FF]">{linkHelpline(message, link)}</p>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="mx-auto mb-8 flex max-w-3xl gap-3.5 rounded-[14px] border border-amber-400/25 bg-amber-900/[0.14] px-[18px] py-4"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-amber-400" aria-hidden="true" />
      <p className="text-[14.5px] leading-[1.6] text-amber-100/90">
        {message}{" "}
        <Link
          href="/usage-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap font-medium text-amber-200 underline decoration-amber-200/45 underline-offset-2 hover:text-amber-100"
        >
          Read the Usage Policy
        </Link>
      </p>
    </div>
  )
}
