import { Folder, Mic, Reply, Volume2 } from "lucide-react"

// Every claim here is backed by shipped code: follow-up context in the research pipeline,
// session rename/favorite/delete and account deletion endpoints, 6 TTS voices with MP3,
// en-US speech input, row-level security on history, the no-results message, the MIT license.
const FEATURES = [
  { icon: Reply, title: "Ask a follow-up", body: "Follow-up questions keep the context of the conversation." },
  { icon: Folder, title: "Find it later", body: "Your research is saved. Rename it, favorite it, or delete it." },
  { icon: Volume2, title: "Listen to a report", body: "Hear any report in one of 6 voices, or download it as an MP3." },
  { icon: Mic, title: "Ask out loud", body: "Speak your question instead of typing it. English, in supported browsers." },
]

const GOOD_TO_KNOW = [
  { title: "Private by default", body: "Your history is private to your account." },
  { title: "Yours to delete", body: "Delete any research, or your whole account, at any time." },
  { title: "Honest about gaps", body: "If the searches find nothing usable, Vettan says so instead of answering anyway." },
  { title: "Open source", body: "The code is public under the MIT license." },
]

const FOUR_COL = "grid grid-cols-1 gap-x-8 md:grid-cols-2 xl:grid-cols-4"

export function Features() {
  return (
    <section aria-labelledby="more-title" className="border-t border-v-line-1">
      <div className="mx-auto max-w-[1240px] px-4 pb-20 pt-24 sm:px-6 lg:px-12">
        <div className="max-w-[640px]">
          <h2 id="more-title" className="text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-v-ink-1 md:text-[36px]">
            What else you can do
          </h2>
          <p className="mt-3.5 text-[17px] leading-[1.55] text-v-ink-2">Research is rarely one question. Vettan keeps the thread.</p>
        </div>
        <div className={`mt-8 ${FOUR_COL}`}>
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 border-t border-v-line-2 py-5">
              <span className="row-span-2 pt-0.5 text-v-violet-300">
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
              </span>
              <h3 className="text-[16px] font-semibold leading-[1.4] text-v-ink-1">{title}</h3>
              <p className="text-[15px] leading-[1.6] text-v-ink-2">{body}</p>
            </div>
          ))}
        </div>
        <h3 className="mt-14 text-[13px] font-semibold text-v-ink-3">Good to know</h3>
        <div className={`mt-2 ${FOUR_COL}`}>
          {GOOD_TO_KNOW.map(({ title, body }) => (
            <div key={title} className="border-t border-v-line-1 py-4">
              <h4 className="text-[14px] font-semibold text-v-ink-1">{title}</h4>
              <p className="mt-1 text-[14px] leading-[1.55] text-v-ink-3">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 max-w-[640px] text-[14px] leading-[1.6] text-v-ink-3">
          Vettan reads up to 5 sources per question and can still be wrong. Check the sources before you rely on an
          answer.
        </p>
      </div>
    </section>
  )
}
