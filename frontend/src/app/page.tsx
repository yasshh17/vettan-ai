import type { Metadata } from "next"
import { LandingV2 } from "@/components/landing-v2/landing-v2"
import { LandingV3 } from "@/components/landing-v3/landing-v3"
import { isLocalV3Home } from "@/lib/landing-preview"

// Landing v62. The previous homepage is kept in @/components/landing/legacy-home.
export const metadata: Metadata = {
  title: "Vettan · Think deeper. Discover faster.",
  description:
    "Ask a hard question. Vettan searches the web, reads the most relevant sources, and writes a report with citations you can check.",
}

export default function HomePage() {
  // LANDING_V3_HOME=1 in a local .env.local tries v3 here before it ships.
  if (isLocalV3Home(process.env)) return <LandingV3 />
  return <LandingV2 density="default" />
}
