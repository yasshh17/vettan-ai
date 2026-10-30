// /preview/landing is unfinished work: off unless a developer opts in, and never on production.
export function isLandingPreviewEnabled(env: Record<string, string | undefined>): boolean {
  return env.LANDING_PREVIEW === "1" && env.VERCEL_ENV !== "production"
}

// Shows landing v3 at / on a developer's own machine. Off on every Vercel deploy, preview or production.
export function isLocalV3Home(env: Record<string, string | undefined>): boolean {
  return env.LANDING_V3_HOME === "1" && !env.VERCEL_ENV
}

// Step heights for comparing how much scrolling the story needs. Preview only.
export const DENSITY_VH = { compact: 45, default: 55, relaxed: 65 } as const
export type Density = keyof typeof DENSITY_VH

export function parseDensity(value: string | string[] | undefined): Density {
  const v = Array.isArray(value) ? value[0] : value
  return v === "compact" || v === "relaxed" ? v : "default"
}
