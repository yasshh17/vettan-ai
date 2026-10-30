"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { ArrowUpRight, Menu, X } from "lucide-react"
import { clearance } from "@/lib/scroll-clearance"
import { useReducedMotion } from "../landing-v2/use-reduced-motion"

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#example", label: "Example report" },
  { href: "#features", label: "Features" },
]

// "Ask a question" goes to the hero's field and puts the cursor in it, ready to type.
// Without the field (or JavaScript) the link still jumps to #start.
function heroField() {
  return document.getElementById("start")?.querySelector<HTMLInputElement>("input") ?? null
}

function goToField(input: HTMLInputElement, reduced: boolean) {
  document.getElementById("start")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
  input.focus({ preventScroll: true })
  history.replaceState(null, "", "#start")
}

export function LandingNavV3({ githubUrl }: { githubUrl: string }) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const headerRef = useRef<HTMLElement>(null)
  const toField = useRef(false)

  // Hash links clear the header by its measured height (same rule as v62).
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

  const linkClass = "rounded-full px-3.5 py-2 text-v-ink-2 no-underline transition-colors hover:bg-[rgb(255_255_255/0.04)] hover:text-v-ink-1"

  return (
    <header ref={headerRef} data-lv2-header className="sticky top-0 z-40 bg-[rgb(9_9_12/0.72)] backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-[68px] max-w-[1312px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <a href="#start" className="text-[20px] font-bold tracking-[-0.015em] text-v-ink-1 no-underline">
          Vettan
        </a>

        <ul className="hidden items-center gap-1 rounded-full border border-v-line-2 bg-[rgb(13_13_18/0.6)] p-1.5 text-[14px] font-medium md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className={linkClass}>
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <a href={githubUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} inline-flex items-center gap-1`}>
              Open source
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>

        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="hidden min-h-10 items-center px-2 text-[14px] font-medium text-v-ink-2 no-underline transition-colors hover:text-v-ink-1 md:inline-flex">
            Sign in
          </Link>
          <a
            href="#start"
            onClick={(e) => {
              const input = heroField()
              if (!input) return
              e.preventDefault()
              goToField(input, reduced)
            }}
            className="inline-flex min-h-11 items-center rounded-full bg-v-ink-1 px-4 text-[14px] font-semibold text-v-on-violet no-underline transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-v-glow"
          >
            <span className="md:hidden">Ask</span>
            <span className="hidden md:inline">Ask a question</span>
          </a>

          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger
              aria-label="Menu"
              className="flex size-11 items-center justify-center rounded-full border border-v-line-3 bg-[rgb(13_13_18/0.6)] text-v-ink-1 md:hidden"
            >
              <Menu aria-hidden="true" className="size-5" />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="lv2 fixed inset-0 z-50 bg-[rgb(0_0_0/0.6)] md:hidden" />
              <Dialog.Content
                aria-describedby={undefined}
                // Closing normally hands focus back to Menu; "Ask a question" sends it to the field instead.
                onCloseAutoFocus={(e) => {
                  const input = toField.current ? heroField() : null
                  toField.current = false
                  if (!input) return
                  e.preventDefault()
                  goToField(input, reduced)
                }}
                className="lv2 fixed inset-x-2 top-2 z-50 rounded-[18px] border border-v-line-3 bg-v-panel p-2 font-v-sans text-v-ink-1 shadow-v-panel md:hidden"
              >
                <div className="flex h-[52px] items-center justify-between px-2">
                  <Dialog.Title className="text-[17px] font-bold">Vettan</Dialog.Title>
                  <Dialog.Close aria-label="Close menu" className="flex size-11 items-center justify-center rounded-full border border-v-line-3 text-v-ink-1">
                    <X aria-hidden="true" className="size-4" />
                  </Dialog.Close>
                </div>
                <ul className="flex flex-col">
                  {LINKS.map((l, i) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="flex min-h-[52px] items-center justify-between rounded-[10px] px-3 text-[17px] font-medium text-v-ink-1 no-underline hover:bg-[rgb(255_255_255/0.04)]"
                      >
                        {l.label}
                        <span aria-hidden="true" className="font-v-mono text-[12px] text-v-ink-4">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      </a>
                    </li>
                  ))}
                  <li>
                    <a
                      href={githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[52px] items-center justify-between rounded-[10px] px-3 text-[17px] font-medium text-v-ink-1 no-underline hover:bg-[rgb(255_255_255/0.04)]"
                    >
                      Open source
                      <ArrowUpRight aria-hidden="true" className="size-4 text-v-ink-4" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                </ul>
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-v-line-1 px-1 pt-3">
                  <Link href="/sign-in" className="flex min-h-12 items-center justify-center rounded-[10px] border border-v-line-3 text-[15px] font-medium text-v-ink-1 no-underline">
                    Sign in
                  </Link>
                  <a
                    href="#start"
                    onClick={(e) => {
                      if (!heroField()) return
                      e.preventDefault()
                      toField.current = true
                      setOpen(false)
                    }}
                    className="flex min-h-12 items-center justify-center rounded-[10px] bg-v-violet-400 text-[15px] font-semibold text-v-on-violet no-underline"
                  >
                    Ask a question
                  </a>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </nav>
    </header>
  )
}
