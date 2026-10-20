import { HeroResearchPanel } from "./hero-research-panel"
import { ResearchField } from "./research-field"

// Static dot field, masked clear behind the headline (canvas v62).
const DOTS: React.CSSProperties = {
  backgroundImage: "radial-gradient(rgba(156,144,255,0.4) 1.1px, rgba(0,0,0,0) 1.7px)",
  backgroundSize: "26px 26px",
  maskImage: "radial-gradient(ellipse 60% 70% at 28% 42%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.8) 88%)",
  WebkitMaskImage: "radial-gradient(ellipse 60% 70% at 28% 42%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.8) 88%)",
  opacity: 0.4,
}

export function HeroSplit() {
  return (
    <section id="start" aria-labelledby="hero-title" className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={DOTS} />

      <div className="relative mx-auto grid max-w-[1240px] items-center gap-12 px-4 pb-[104px] pt-[72px] sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:px-12">
        <div>
          <h1
            id="hero-title"
            className="lv2-fade text-[36px] font-extrabold leading-[1.02] tracking-[-0.03em] text-v-ink-1 min-[400px]:text-[40px] md:text-[48px] xl:text-[58px]"
          >
            Think deeper.
            <br />
            Discover faster.
          </h1>
          <p className="lv2-fade mt-6 max-w-[500px] text-[19px] leading-[1.6] text-v-ink-2">
            Ask a hard question. Vettan searches the web, reads the most relevant sources, and writes a report with
            citations you can check.
          </p>
          <div className="mt-8">
            <ResearchField />
          </div>
          <a
            href="#example"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-v-ink-1 no-underline hover:text-v-violet-200"
          >
            View recorded example <span aria-hidden="true">↓</span>
          </a>
        </div>

        <HeroResearchPanel />
      </div>
    </section>
  )
}
