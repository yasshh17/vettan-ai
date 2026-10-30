"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { ArrowUp, Code2, Lock, Mic, Pencil, Star, Trash2, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEMO, DEMO_CITATIONS } from "@/lib/research-demo"
import { rng } from "@/lib/constellation/math"
import { VOICES } from "@/lib/voices"

// The app's own placeholder once a report is on screen (sticky-search-bar.tsx).
const FOLLOW_UP_PLACEHOLDER = "Ask a follow-up question..."

// Bar heights for the decorative waveform, the same on every render.
const BARS = (() => {
  const random = rng(21)
  return Array.from({ length: 36 }, () => ({ h: 8 + Math.round(random() * 30), dur: 0.7 + random() * 0.8, delay: random() }))
})()

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Every claim here is backed by shipped code: follow-up context (one chat call over the
// conversation, no new search), session rename/favorite/delete and account deletion, 6 TTS voices
// with MP3 download, en-US speech input, row-level security on history, the empty-results message,
// the MIT license.
const GOOD_TO_KNOW = [
  { icon: Lock, title: "Private by default", body: "Your history is private to your account." },
  { icon: Trash2, title: "Yours to delete", body: "Delete any research, or your whole account, at any time." },
  { icon: TriangleAlert, title: "Honest about gaps", body: "If the searches come back empty, Vettan says so instead of guessing." },
  { icon: Code2, title: "Open source", body: "The code is public under the MIT license." },
]

const DEMO_BOX = "relative h-[200px] overflow-hidden rounded-[12px] border border-v-line-1 bg-[#0b0b10]"

function FollowUpDemo() {
  return (
    <div aria-hidden="true" className={cn(DEMO_BOX, "flex flex-col gap-2.5 p-[18px]")}>
      <div className="max-w-[80%] self-end rounded-[12px_12px_4px_12px] border border-[rgb(182_172_255/0.25)] bg-[rgb(124_111_240/0.16)] px-3 py-2 text-[13px] text-v-ink-1">
        {DEMO.query}
      </div>
      <div className="flex items-center gap-2 font-v-mono text-[11px] text-v-ink-3">
        <span className="size-1.5 rounded-full bg-v-violet-400 shadow-[0_0_8px_#9c90ff]" />
        Report ready · {DEMO.sources.length} sources · {DEMO_CITATIONS.length} citations
      </div>
      <span className="lv3-thread absolute left-[30px] top-[84px] h-[62px] w-0.5 rounded-sm bg-[linear-gradient(180deg,rgb(156_144_255/0)_0%,#c9c2ff_50%,rgb(156_144_255/0)_100%)] [background-size:2px_120px]" />
      <div className="mt-auto flex h-[46px] items-center gap-2 rounded-[12px] border border-[rgb(182_172_255/0.3)] bg-[rgb(13_13_18/0.9)] pl-3.5 pr-1.5">
        <span className="flex-1 truncate text-[14px] text-v-ink-4">
          {FOLLOW_UP_PLACEHOLDER}
          <span className="lv3-caret ml-[3px] inline-block h-[18px] w-0.5 bg-v-violet-200 align-[-3px]" />
        </span>
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-v-violet-400 text-v-on-violet">
          <ArrowUp className="size-3.5" strokeWidth={2.4} />
        </span>
      </div>
    </div>
  )
}

function HistoryDemo() {
  return (
    <div aria-hidden="true" className={cn(DEMO_BOX, "flex flex-col gap-2 p-3.5")}>
      <p className="mb-0.5 font-v-mono text-[10.5px] uppercase tracking-[0.06em] text-v-ink-4">Your research</p>
      <div className="flex items-center gap-2.5 rounded-[10px] border border-[rgb(182_172_255/0.3)] bg-[rgb(124_111_240/0.1)] px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-v-ink-1">{DEMO.query}</span>
        <span className="relative inline-flex text-v-ink-3">
          <Star className="size-[15px]" />
          <Star className="lv3-fav absolute inset-0 size-[15px] fill-v-violet-200 text-v-violet-200" />
        </span>
        <Pencil className="size-[15px] shrink-0 text-v-ink-3" />
        <Trash2 className="size-[15px] shrink-0 text-v-ink-3" />
      </div>
      <div className="flex h-[38px] items-center rounded-[10px] border border-v-line-1 bg-[rgb(255_255_255/0.015)] px-3">
        <span className="h-[7px] w-[52%] rounded bg-[rgb(255_255_255/0.07)]" />
      </div>
      <div className="flex h-[38px] items-center rounded-[10px] border border-v-line-1 bg-[rgb(255_255_255/0.015)] px-3">
        <span className="h-[7px] w-[38%] rounded bg-[rgb(255_255_255/0.06)]" />
      </div>
      <p className="mt-auto font-v-mono text-[11px] text-v-ink-3">Favorite · rename · delete</p>
    </div>
  )
}

// An illustration only: nothing here plays audio, so nothing is drawn as a button.
function ListenDemo() {
  return (
    <div aria-hidden="true" className={cn(DEMO_BOX, "flex flex-col gap-3 p-4")}>
      <div className="flex h-11 items-center gap-[3px] overflow-hidden">
        {BARS.map((b, i) => (
          <span
            key={i}
            className="lv3-bar block w-1 shrink-0 rounded-sm bg-[linear-gradient(180deg,#d6d0ff,#9c90ff)]"
            style={{ height: b.h, animationDuration: `${b.dur.toFixed(2)}s`, animationDelay: `-${b.delay.toFixed(2)}s` }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] leading-[1.35]">
        {Object.entries(VOICES).map(([id, desc]) => (
          <li key={id} className="flex flex-col">
            <span className="font-semibold text-v-ink-1">{capitalize(id)}</span>
            <span className="text-v-ink-3">{desc}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const SPOKEN = DEMO.query.split(" ")

function VoiceDemo() {
  return (
    <div aria-hidden="true" className={cn(DEMO_BOX, "flex items-center gap-[22px] p-[18px]")}>
      <div className="relative size-[76px] shrink-0">
        {[0, 0.6, 1.2].map((d) => (
          <span key={d} className="lv3-ring absolute inset-0 rounded-full border-2 border-[rgb(182_172_255/0.6)]" style={{ animationDelay: `${d}s` }} />
        ))}
        <span className="absolute inset-2.5 flex items-center justify-center rounded-full bg-v-violet-400 text-v-on-violet shadow-[0_0_30px_rgb(156_144_255/0.55)]">
          <Mic className="size-6" />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-v-mono text-[11px] text-v-violet-200">Listening · English (en-US)</span>
        {/* Word by word, so the reveal reads right however the question wraps. */}
        <span className="lv3-type min-h-[50px] text-[17px] font-medium leading-[1.45] text-v-ink-1">
          {SPOKEN.map((word, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties}>
              {i ? ` ${word}` : word}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}

const TILES = [
  {
    title: "Ask a follow-up",
    body: "Follow-ups keep the context of the conversation, so you don't start from zero. They're answered from what's already there; ask a new question for fresh sources.",
    Demo: FollowUpDemo,
  },
  { title: "Find it later", body: "Your research is saved. Rename it, favorite it, or delete it.", Demo: HistoryDemo },
  { title: "Listen to a report", body: "Hear any report in one of 6 voices, or download it as an MP3.", Demo: ListenDemo },
  { title: "Ask out loud", body: "Speak your question instead of typing it. English, in supported browsers.", Demo: VoiceDemo },
]

export function FeaturesV3() {
  const ref = useRef<HTMLElement>(null)
  const [onScreen, setOnScreen] = useState(true)

  // The demos' loops stop while the section is off-screen.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      id="features"
      aria-labelledby="features-title"
      className={cn("scroll-mt-[var(--header-clear)] border-t border-v-line-1", !onScreen && "lv3-paused")}
    >
      <div className="mx-auto max-w-[1312px] px-4 pb-20 pt-20 sm:px-6 lg:px-12 lg:pt-24">
        <div className="max-w-[720px]">
          <p className="font-v-mono text-[12px] uppercase tracking-[0.08em] text-v-violet-200">What else you can do</p>
          <h2 id="features-title" className="mt-2.5 text-[30px] font-extrabold leading-[1.08] tracking-[-0.035em] text-v-ink-1 md:text-[40px]">
            Research is rarely one question.
          </h2>
          <p className="mt-3 text-[17px] leading-[1.6] text-v-ink-2">Vettan keeps the thread: follow up, come back later, listen, or just ask out loud.</p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {TILES.map(({ title, body, Demo }) => (
            <article key={title} className="rounded-[18px] border border-v-line-2 bg-[rgb(255_255_255/0.015)] p-4 transition-colors hover:border-[rgb(182_172_255/0.35)] sm:p-5">
              <Demo />
              <h3 className="mt-[18px] text-[19px] font-semibold text-v-ink-1">{title}</h3>
              <p className="mt-1.5 text-[15px] leading-[1.6] text-v-ink-2">{body}</p>
            </article>
          ))}
        </div>

        <h3 className="mt-14 font-v-mono text-[12px] font-medium uppercase tracking-[0.08em] text-v-ink-3">Good to know</h3>
        <div className="mt-3.5 grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
          {GOOD_TO_KNOW.map(({ icon: Icon, title, body }) => (
            <div key={title} className="border-t border-v-line-2 py-[18px]">
              <span aria-hidden="true" className="inline-flex size-[34px] items-center justify-center rounded-[10px] bg-[rgb(124_111_240/0.14)] text-v-violet-200">
                <Icon className="size-4" />
              </span>
              <h4 className="mt-3 text-[15px] font-semibold text-v-ink-1">{title}</h4>
              <p className="mt-1 text-[14px] leading-[1.55] text-v-ink-3">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-7 max-w-[720px] text-[14px] leading-[1.6] text-v-ink-3">
          Vettan uses excerpts from up to {DEMO.sources.length} sources per question and can still be wrong. Check the sources before you
          rely on an answer.
        </p>
      </div>
    </section>
  )
}
