import Link from "next/link"

export function Hero() {
  return (
    <section className="relative z-10 mx-auto flex max-w-[900px] flex-col items-center px-12 pb-[100px] pt-[110px] text-center">
      <div
        className="animate-fadeup inline-flex items-center gap-1.5 rounded-full border border-[rgba(156,144,255,0.15)] bg-[rgba(124,111,240,0.07)] px-3 py-1 font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.08em] text-[#B6ACFF] opacity-0"
        style={{ animationDelay: "0s" }}
      >
        <span className="h-[5px] w-[5px] rounded-full bg-[#9C90FF]" />
        ReAct-based multi-agent system
      </div>

      <h1
        className="animate-fadeup mt-7 text-[clamp(44px,7vw,72px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-[#EDEDF2] opacity-0"
        style={{ animationDelay: "0.08s" }}
      >
        Vettan reasons
        <br />
        before it answers.
      </h1>

      <p
        className="animate-fadeup mt-6 max-w-[560px] text-[19px] leading-[1.55] text-[#A6A6B3] opacity-0"
        style={{ animationDelay: "0.16s" }}
      >
        A ReAct-driven multi-agent system that plans, searches, verifies, and
        synthesizes — so you get a considered answer instead of a list of links to
        sort through yourself.
      </p>

      <div
        className="animate-fadeup mt-9 flex flex-wrap items-center justify-center gap-3.5 opacity-0"
        style={{ animationDelay: "0.24s" }}
      >
        <Link
          href="/sign-up"
          className="rounded-[10px] bg-[#9C90FF] px-6 py-3 text-[14px] font-semibold text-[#0B0B10] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(124,111,240,0.4)]"
        >
          Try Vettan
        </Link>
        <Link
          href="#architecture"
          className="rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] px-6 py-3 text-[14px] font-semibold text-[#EDEDF2] transition-colors duration-150 hover:border-[rgba(255,255,255,0.25)]"
        >
          See the architecture
        </Link>
      </div>
    </section>
  )
}
