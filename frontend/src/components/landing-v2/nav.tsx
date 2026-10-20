"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, Menu, X } from "lucide-react"
import { clearance } from "@/lib/scroll-clearance"

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#example", label: "Example" },
]

export function LandingNav({ githubUrl }: { githubUrl: string }) {
  const [open, setOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  // Hash links clear the header by its measured height, not an assumed one.
  useEffect(() => {
    const header = headerRef.current
    const root = header?.closest<HTMLElement>(".lv2")
    if (!header || !root || typeof ResizeObserver === "undefined") return
    const write = () => root.style.setProperty("--header-clear", `${clearance(header.getBoundingClientRect().height)}px`)
    write()
    const ro = new ResizeObserver(write)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  return (
    <header ref={headerRef} data-lv2-header className="sticky top-0 z-40 border-b border-v-line-1 bg-[rgb(9_9_12/0.82)] backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-12">
        <a href="#start" className="text-[19px] font-bold tracking-[-0.01em] text-v-ink-1 no-underline">
          Vettan
        </a>

        <ul className="hidden items-center gap-7 text-[14px] font-medium md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-v-ink-3 no-underline transition-colors hover:text-v-ink-1">
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-v-ink-3 no-underline transition-colors hover:text-v-ink-1"
            >
              Open source
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>

        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden min-h-10 items-center px-2 text-[14px] font-medium text-v-ink-3 no-underline transition-colors hover:text-v-ink-1 md:inline-flex"
          >
            Sign in
          </Link>
          <a
            href="#start"
            className="inline-flex min-h-10 items-center rounded-v-button bg-v-violet-400 px-4 text-[14px] font-semibold text-v-on-violet no-underline transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-v-glow"
          >
            Try Vettan
          </a>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="lv2-menu"
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="flex size-11 items-center justify-center rounded-v-button border border-v-line-3 text-v-ink-1 md:hidden"
          >
            {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </button>
        </div>
      </nav>

      {open ? (
        <div id="lv2-menu" className="border-t border-v-line-1 bg-v-panel md:hidden">
          <ul className="mx-auto flex max-w-[1240px] flex-col px-4 pb-2 pt-1 sm:px-6">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center border-b border-v-line-1 text-[16px] font-medium text-v-ink-2 no-underline"
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-12 items-center gap-1.5 border-b border-v-line-1 text-[16px] font-medium text-v-ink-2 no-underline"
              >
                Open source <ArrowUpRight aria-hidden="true" className="size-4" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
            <li>
              <Link href="/sign-in" className="flex min-h-12 items-center text-[16px] font-medium text-v-ink-2 no-underline">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </header>
  )
}
