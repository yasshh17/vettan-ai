import type { Metadata } from "next"
import { LandingV3 } from "@/components/landing-v3/landing-v3"

// Landing v3. v62 stays at the gated /preview/landing; the homepage before it is in @/components/landing/legacy-home.
export const metadata: Metadata = {
  title: "Vettan · Research you can check.",
  description:
    "Ask a hard question. Vettan splits it into focused searches, reads excerpts from the most relevant pages and writes a report with citations you can open.",
}

export default function HomePage() {
  return <LandingV3 />
}
