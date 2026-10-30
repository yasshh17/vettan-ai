import { QUESTION } from "./geometry"
import { gaussian, rng, type Vec3 } from "./math"

export type Tier = "desktop" | "tablet" | "phone" | "low"

// Share of the full particle count each tier draws.
export const TIER_SCALE: Record<Tier, number> = { desktop: 1, tablet: 0.66, phone: 0.55, low: 0.33 }

export function pickTier({ width, cores, saveData }: { width: number; cores?: number; saveData?: boolean }): Tier {
  if (saveData || (cores !== undefined && cores <= 4)) return "low"
  if (width < 768) return "phone"
  if (width < 1024) return "tablet"
  return "desktop"
}

export type Color = readonly [number, number, number]
export const STAR: Color = [244, 242, 255]
export const V100: Color = [214, 208, 255]
export const V300: Color = [182, 172, 255]
export const V400: Color = [156, 144, 255]
export const V500: Color = [124, 111, 240]

export type Particle =
  | { kind: "dust"; base: Vec3; phase: number; size: number; color: Color; alpha: number }
  | { kind: "core"; offset: Vec3; start: Vec3; delay: number; size: number; color: Color; alpha: number }
  | { kind: "stream"; index: number; u0: number; jitter: Vec3; speed: number; size: number; color: Color; alpha: number }
  | { kind: "ring"; angle: number; jitter: Vec3; size: number; alpha: number }
  | { kind: "toSource"; index: number; u0: number; jitter: Vec3; size: number; alpha: number }
  | { kind: "thread"; index: number; u0: number; jitter: Vec3; size: number; alpha: number }
  | { kind: "cluster"; index: number; offset: Vec3; size: number; alpha: number }
  | { kind: "fall"; seed: number; jx: number; jz: number; size: number; alpha: number }
  | { kind: "line"; row: number; f: number; jy: number; size: number }

// Full (desktop) counts; tiers scale them down.
const COUNTS = { dust: 1300, core: 1000, halo: 500, stream: 520, ring: 520, toSource: 170, thread: 230, cluster: 130, fall: 520, line: 150 }
export const LINE_LENGTHS = [0.75, 0.95, 0.9, 0.97, 0.7, 0.93, 0.85, 0.6, 0.8]

export function buildParticles(scale: number, seed = 11): Particle[] {
  const random = rng(seed)
  const randn = gaussian(random)
  const n = (c: number) => Math.max(1, Math.round(c * scale))
  const p: Particle[] = []
  for (let i = 0; i < n(COUNTS.dust); i++) {
    p.push({ kind: "dust", base: [(random() * 2 - 1) * 9, (random() * 2 - 1) * 4.6, -7 + random() * 9], phase: random() * 6.28, size: 0.012 + random() * 0.02, color: random() < 0.2 ? V100 : V300, alpha: 0.05 + random() * 0.2 })
  }
  const coreCount = n(COUNTS.core)
  for (let i = 0; i < coreCount + n(COUNTS.halo); i++) {
    const inner = i < coreCount
    const sd = inner ? 0.17 : 0.48
    const dir = [randn(), randn() * 0.7, randn() * 0.8]
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const r = 1.5 + random() * 3
    p.push({
      kind: "core",
      offset: [randn() * sd, randn() * sd, randn() * sd],
      start: [QUESTION[0] + (dir[0] / len) * r, QUESTION[1] + (dir[1] / len) * r, QUESTION[2] + (dir[2] / len) * r],
      delay: random() * 0.5,
      size: inner ? 0.032 : 0.026,
      color: inner ? (random() < 0.5 ? STAR : V100) : V400,
      alpha: inner ? 0.45 : 0.22,
    })
  }
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < n(COUNTS.stream); i++) {
      p.push({ kind: "stream", index: k, u0: random(), jitter: [randn(), randn(), randn()], speed: 0.035 + random() * 0.02, size: 0.026, color: random() < 0.25 ? V100 : V400, alpha: 0.32 + 0.2 * random() })
    }
  }
  for (let i = 0; i < n(COUNTS.ring); i++) p.push({ kind: "ring", angle: random() * Math.PI * 2, jitter: [randn() * 0.018, randn() * 0.018, randn() * 0.018], size: 0.026, alpha: 0.55 })
  for (let k = 0; k < 5; k++) {
    for (let i = 0; i < n(COUNTS.toSource); i++) p.push({ kind: "toSource", index: k, u0: random(), jitter: [randn() * 0.02, randn() * 0.02, randn() * 0.02], size: 0.022, alpha: 0.28 })
    for (let i = 0; i < n(COUNTS.thread); i++) p.push({ kind: "thread", index: k, u0: random(), jitter: [randn() * 0.012, randn() * 0.012, randn() * 0.012], size: 0.022, alpha: 0.33 })
    for (let i = 0; i < n(COUNTS.cluster); i++) p.push({ kind: "cluster", index: k, offset: [randn() * 0.06, randn() * 0.06, randn() * 0.06], size: 0.03, alpha: 0.7 })
  }
  for (let i = 0; i < n(COUNTS.fall); i++) p.push({ kind: "fall", seed: random(), jx: randn(), jz: randn(), size: 0.02, alpha: 0.38 })
  for (let row = 0; row < LINE_LENGTHS.length; row++) {
    for (let i = 0; i < n(COUNTS.line); i++) p.push({ kind: "line", row, f: random() * LINE_LENGTHS[row], jy: randn() * 0.012, size: row === 0 ? 0.03 : 0.022 })
  }
  return p
}
