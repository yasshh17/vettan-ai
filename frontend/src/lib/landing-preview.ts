// /preview/landing is unfinished work: off unless a developer opts in, and never on production.
export function isLandingPreviewEnabled(env: Record<string, string | undefined>): boolean {
  return env.LANDING_PREVIEW === "1" && env.VERCEL_ENV !== "production"
}

// Step heights for comparing how much scrolling the story needs. Preview only.
export const DENSITY_VH = { compact: 45, default: 55, relaxed: 65 } as const
export type Density = keyof typeof DENSITY_VH

export function parseDensity(value: string | string[] | undefined): Density {
  const v = Array.isArray(value) ? value[0] : value
  return v === "compact" || v === "relaxed" ? v : "default"
}
