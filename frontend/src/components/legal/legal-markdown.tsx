import Link from "next/link"
import type { ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { slugify, splitHeading } from "@/lib/legal-headings"

// No rehype-raw: raw HTML must never render (see markdown-xss.test.tsx).

const MONO = "font-[family-name:var(--font-geist-mono)]"
const LINK =
  "text-[#B6ACFF] underline decoration-[rgba(182,172,255,0.35)] underline-offset-[3px] transition-colors hover:text-[#D6D0FF] hover:decoration-[rgba(214,208,255,0.85)]"

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children)
  }
  return ""
}

const shared: Components = {
  p: ({ children }) => <p className="mb-4">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[#EDEDF2]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className={`${MONO} rounded-md bg-[rgba(156,144,255,0.1)] px-1.5 py-0.5 text-[13px] text-[#D6D0FF]`}>
      {children}
    </code>
  ),
  a: ({ href = "", children }) => {
    if (href.startsWith("/")) {
      return (
        <Link href={href} className={LINK}>
          {children}
        </Link>
      )
    }
    if (href.startsWith("#") || href.startsWith("mailto:")) {
      return (
        <a href={href} className={LINK}>
          {children}
        </a>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
        {children}
      </a>
    )
  },
}

const document: Components = {
  ...shared,
  h2: ({ children }) => {
    const heading = textOf(children)
    const id = slugify(heading)
    const { number, title } = splitHeading(heading)
    return (
      <h2
        id={id}
        className="group mb-[18px] mt-14 flex scroll-mt-24 items-baseline gap-3.5 border-t border-white/[0.06] pt-10 text-[23px] font-semibold leading-[1.3] tracking-[-0.015em] text-[#EDEDF2]"
      >
        {number && <span className={`${MONO} text-sm font-medium text-[#9C90FF]`}>{number}</span>}
        <span>{title}</span>
        <a
          href={`#${id}`}
          aria-label={`Link to "${title}"`}
          className="text-lg text-[#6E6699] no-underline opacity-0 transition-opacity hover:text-[#9C90FF] focus-visible:opacity-100 group-hover:opacity-100"
        >
          #
        </a>
      </h2>
    )
  },
  h3: ({ children }) => (
    <h3
      id={slugify(textOf(children))}
      className="mb-3 mt-8 scroll-mt-24 text-[17px] font-semibold tracking-[-0.01em] text-[#EDEDF2]"
    >
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 list-disc space-y-[7px] pl-5 marker:text-[#6E6699]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-decimal space-y-[7px] pl-5 marker:text-[#6E6699]">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-[14px] border border-white/[0.08]">
      <table className="w-full min-w-[560px] border-collapse text-[14.5px] leading-[1.55] [&_tr:last-child_td]:border-b-0">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      scope="col"
      className={`${MONO} border-b border-white/[0.08] bg-white/[0.025] px-4 py-3 text-left text-[11.5px] font-medium uppercase tracking-[0.1em] text-[#8A8A96]`}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-white/[0.06] px-4 py-3.5 align-top text-[#C4C4CE] first:font-medium first:text-[#EDEDF2]">
      {children}
    </td>
  ),
}

const keyPoints: Components = {
  ...shared,
  ul: ({ children }) => (
    <ul className="flex flex-col gap-3 text-[15.5px] leading-[1.6]">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="relative pl-[18px] before:absolute before:left-0 before:top-[10px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[#9C90FF]">
      {children}
    </li>
  ),
}

export function LegalMarkdown({
  children,
  variant = "document",
}: {
  children: string
  variant?: "document" | "keyPoints"
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={variant === "keyPoints" ? keyPoints : document}
    >
      {children}
    </ReactMarkdown>
  )
}
