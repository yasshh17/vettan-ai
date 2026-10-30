import { GITHUB_URL } from "@/components/legal/legal-page"
import { ClosingCtaV3, FooterV3 } from "./closing"
import { FeaturesV3 } from "./features"
import { HeroV3 } from "./hero/hero"
import { LandingNavV3 } from "./nav"
import { ReportV3 } from "./report/report"
import { StoryV3 } from "./story/story"

// Landing v3 ("Research Observatory"), behind /preview/observatory and the local LANDING_V3_HOME flag.
// `.lv2` keeps v62's shared rules: focus ring, header clearance and the reduced-motion switch.
export function LandingV3() {
  return (
    <div className="lv2 relative min-h-screen overflow-x-clip bg-v-ground font-v-sans text-v-ink-1 antialiased">
      <LandingNavV3 githubUrl={GITHUB_URL} />
      <main>
        <HeroV3 />
        <StoryV3 />
        <ReportV3 />
        <FeaturesV3 />
        <ClosingCtaV3 />
      </main>
      <FooterV3 />
    </div>
  )
}
