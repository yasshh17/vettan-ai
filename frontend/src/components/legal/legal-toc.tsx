"use client"

import { useEffect, useState } from "react"
import { ArrowUp, ChevronDown, List } from "lucide-react"

export interface TocItem {
  id: string
  label: string
}

const MONO = "font-[family-name:var(--font-geist-mono)]"

function activeIndex(ids: string[]): number {
  // The last section is too short to reach the top.
  const atBottom =
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
  if (atBottom && window.scrollY > 0) return ids.length - 1
  let active = 0
  ids.forEach((id, i) => {
    const el = document.getElementById(id)
    if (el && el.getBoundingClientRect().top <= 120) active = i
  })
  return active
}

export function LegalToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const ids = items.map((item) => item.id)
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setActive(activeIndex(ids)))
    }
    update()
    // With a #hash in the URL, the browser scrolls after mount.
    const settle = window.setTimeout(update, 150)
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    window.addEventListener("hashchange", update)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      window.removeEventListener("hashchange", update)
    }
  }, [items])

  return (
    <nav aria-label="On this page">
      <p className={`${MONO} mb-3.5 text-[11.5px] uppercase tracking-[0.12em] text-[#8A8A96]`}>
        On this page
      </p>
      <ol className="border-l border-white/[0.08]">
        {items.map((item, i) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={i === active ? "location" : undefined}
              className={`-ml-px block border-l py-1.5 pl-4 text-[13.5px] leading-[1.4] transition-colors ${
                i === active
                  ? "border-[#9C90FF] text-[#EDEDF2]"
                  : "border-transparent text-[#8A8A96] hover:text-[#EDEDF2]"
              }`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function LegalTocDisclosure({ items }: { items: TocItem[] }) {
  return (
    <details className="group mb-8 rounded-[14px] border border-white/10 bg-white/[0.025] lg:hidden">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 text-[14.5px] font-medium text-[#EDEDF2] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <List className="h-4 w-4 text-[#9C90FF]" aria-hidden="true" />
          On this page
        </span>
        <ChevronDown
          className="h-[18px] w-[18px] text-[#9B9BA8] transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ol className="mx-4 mb-3 border-l border-white/[0.08]">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="-ml-px block border-l border-transparent py-2.5 pl-3.5 text-[14.5px] leading-[1.4] text-[#9B9BA8] hover:text-[#EDEDF2]"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </details>
  )
}

export function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const update = () => setVisible(window.scrollY > 800)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [])

  return (
    <a
      href="#top"
      aria-label="Back to top"
      className={`fixed bottom-5 right-4 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#17171d] text-[#EDEDF2] shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_10px_30px_rgba(0,0,0,0.5)] transition-opacity print:hidden lg:hidden ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <ArrowUp className="h-[18px] w-[18px]" aria-hidden="true" />
    </a>
  )
}
