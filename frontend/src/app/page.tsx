import type { Metadata } from "next"
import { LandingV2 } from "@/components/landing-v2/landing-v2"

// Landing v62. The previous homepage is kept in @/components/landing/legacy-home.
export const metadata: Metadata = {
  title: "Vettan · Think deeper. Discover faster.",
  description:
    "Ask a hard question. Vettan searches the web, reads the most relevant sources, and writes a report with citations you can check.",
}

export default function HomePage() {
  return <LandingV2 density="default" />
}
