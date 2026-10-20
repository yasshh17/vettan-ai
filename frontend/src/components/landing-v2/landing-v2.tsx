import { GITHUB_URL } from "@/components/legal/legal-page"
import { DENSITY_VH, type Density } from "@/lib/landing-preview"
import { ExampleReport } from "./example-report"
import { Features } from "./features"
import { ClosingCta, LandingFooter } from "./footer"
import { HeroSplit } from "./hero/hero-split"
import { LandingNav } from "./nav"
import { ResearchStory } from "./story/research-story"

// Without JS the staged demo content would stay at its hidden starting pose.
const NO_SCRIPT = "<style>.lv2 [data-lv2-step]{opacity:1!important;transform:none!important}</style>"

export function LandingV2({ density }: { density: Density }) {
  return (
    <div className="lv2 relative min-h-screen overflow-x-clip bg-v-ground font-v-sans text-v-ink-1 antialiased">
      <noscript dangerouslySetInnerHTML={{ __html: NO_SCRIPT }} />
      <LandingNav githubUrl={GITHUB_URL} />
      <main>
        <HeroSplit />
        <ResearchStory stepVh={DENSITY_VH[density]} />
        <ExampleReport />
        <Features />
        <ClosingCta />
      </main>
      <LandingFooter />
    </div>
  )
}
