export type Vec3 = readonly [number, number, number]
export type Curve = readonly [Vec3, Vec3, Vec3, Vec3]

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)

export const smoothstep = (x: number) => {
  const k = clamp01(x)
  return k * k * (3 - 2 * k)
}

export const easeInOut = (x: number) => {
  const k = clamp01(x)
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
}

export const add = (a: Vec3, x: number, y: number, z: number): Vec3 => [a[0] + x, a[1] + y, a[2] + z]

// Writes into `out` so the per-particle loop doesn't allocate.
export function bezier(c: Curve, t: number, out: number[]): number[] {
  const [a, b, d, e] = c
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  out[0] = a[0] * w0 + b[0] * w1 + d[0] * w2 + e[0] * w3
  out[1] = a[1] * w0 + b[1] * w1 + d[1] * w2 + e[1] * w3
  out[2] = a[2] * w0 + b[2] * w1 + d[2] * w2 + e[2] * w3
  return out
}

// Seeded so the scene looks the same on every load and in tests.
export function rng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(random: () => number): () => number {
  return () => {
    let u = 0
    let v = 0
    while (u === 0) u = random()
    while (v === 0) v = random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}
