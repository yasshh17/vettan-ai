import type { Metadata } from "next"
import { connection } from "next/server"
import { notFound } from "next/navigation"
import { LandingV2 } from "@/components/landing-v2/landing-v2"
import { isLandingPreviewEnabled, parseDensity } from "@/lib/landing-preview"

export const metadata: Metadata = {
  title: "Landing preview · Vettan",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

export default async function LandingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ density?: string | string[] }>
}) {
  // Decide per request: a build-time prerender would freeze whatever the flag was at build.
  await connection()
  if (!isLandingPreviewEnabled(process.env)) notFound()
  const { density } = await searchParams
  return <LandingV2 density={parseDensity(density)} />
}
