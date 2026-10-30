import type { Metadata } from "next"
import { connection } from "next/server"
import { notFound } from "next/navigation"
import { LandingV3 } from "@/components/landing-v3/landing-v3"
import { isLandingPreviewEnabled } from "@/lib/landing-preview"

// Landing v3 while it's built. Same gate as /preview/landing: a developer flag, never production.
export const metadata: Metadata = {
  title: "Observatory preview · Vettan",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

export default async function ObservatoryPreviewPage() {
  // Decide per request: a build-time prerender would freeze whatever the flag was at build.
  await connection()
  if (!isLandingPreviewEnabled(process.env)) notFound()
  return <LandingV3 />
}
