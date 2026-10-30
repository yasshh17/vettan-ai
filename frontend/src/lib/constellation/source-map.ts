// The report's small map of its five sources. Sources cited in the paragraph being read glow;
// the one pointed at or selected flares and sends light toward the report.
import { FlatField } from "./flat"
import { gaussian, rng } from "./math"
import { STAR, V100, V300, V400 } from "./particles"

// Positions as fractions of the panel: [x, y, size]. Wide panel first, then the phone strip.
const WIDE_STARS = [[0.173, 0.304, 0.85], [0.481, 0.704, 1.0], [0.327, 0.513, 1.05], [0.577, 0.322, 0.95], [0.173, 0.748, 0.9]] as const
const WIDE_RING = [0.827, 0.513] as const
const NARROW_STARS = [[0.156, 0.314, 0.85], [0.547, 0.743, 1.0], [0.363, 0.529, 1.05], [0.631, 0.314, 0.95], [0.123, 0.771, 0.9]] as const
const NARROW_RING = [0.899, 0.543] as const
const GROUND = "#0b0b10"

type Dot =
  | { kind: "dust"; x: number; y: number; phase: number; size: number; alpha: number }
  | { kind: "star"; index: number; ox: number; oy: number; size: number }
  | { kind: "flow"; index: number; u: number; jitter: number; size: number }
  | { kind: "ring"; angle: number; jitter: number }

export interface SourceMapState {
  // 1-based rank pointed at or selected; 0 for none.
  active: number
  // Ranks cited in the paragraph in view.
  inView: readonly number[]
}

export class SourceMap {
  readonly field: FlatField
  private dots: Dot[] = []
  private flare = [0, 0, 0, 0, 0, 0]
  private last = 0

  constructor(canvas: HTMLCanvasElement, scale: number) {
    this.field = new FlatField(canvas)
    const random = rng(9)
    const randn = gaussian(random)
    const n = (count: number) => Math.round(count * scale)
    for (let i = 0; i < n(260); i++)
      this.dots.push({ kind: "dust", x: random(), y: random(), phase: random() * 6.28, size: 1 + random() * 1.6, alpha: 0.05 + random() * 0.2 })
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < n(70); i++) this.dots.push({ kind: "star", index: k, ox: randn() * 6, oy: randn() * 6, size: 2 + random() * 1.5 })
      for (let i = 0; i < n(60); i++) this.dots.push({ kind: "flow", index: k, u: random(), jitter: randn() * 1.6, size: 1.6 + random() })
    }
    for (let i = 0; i < n(160); i++) this.dots.push({ kind: "ring", angle: random() * Math.PI * 2, jitter: randn() * 1.2 })
  }

  resize(width: number, height: number, dpr: number) {
    this.field.resize(width, height, dpr)
  }

  draw(t: number, { active, inView }: SourceMapState) {
    const f = this.field
    const W = f.width
    const H = f.height
    if (!W || !H) return
    const narrow = W < 420
    const stars = narrow ? NARROW_STARS : WIDE_STARS
    const ring = narrow ? NARROW_RING : WIDE_RING
    const at = (k: number) => [stars[k][0] * W, stars[k][1] * H, stars[k][2]] as const
    const rx = ring[0] * W
    const ry = ring[1] * H
    const ringR = Math.min(26, H * 0.18)

    // Flares ease toward their targets so lights fade rather than switch.
    const dt = this.last ? Math.min(0.1, Math.max(0, t - this.last)) : 1
    this.last = t
    for (let r = 1; r <= 5; r++) {
      const want = active === r ? 1 : inView.includes(r) ? 0.45 : 0
      this.flare[r] += (want - this.flare[r]) * Math.min(1, dt * 6)
    }

    f.begin(GROUND)
    for (const d of this.dots) {
      if (d.kind === "dust") {
        f.put(d.x * W + Math.sin(t * 0.2 + d.phase) * 3, d.y * H + Math.cos(t * 0.17 + d.phase) * 2, d.size * 2.2, V300, d.alpha)
      } else if (d.kind === "star") {
        const [x, y, s] = at(d.index)
        const fl = this.flare[d.index + 1]
        const breathe = (1 + 0.06 * Math.sin(t * 1.5 + d.index)) * (1 + fl * 0.4)
        f.put(x + d.ox * breathe, y + d.oy * breathe, d.size * 2.4 * s, STAR, (0.4 + 0.4 * fl) * (active && active !== d.index + 1 ? 0.55 : 1))
      } else if (d.kind === "flow") {
        const [x, y] = at(d.index)
        const u = (d.u + t * 0.05) % 1
        f.put(rx + (x - rx) * u, ry + (y - ry) * u - Math.sin(u * Math.PI) * (y - ry) * 0.25 + d.jitter, d.size * 2, V400, 0.28 * (active && active !== d.index + 1 ? 0.4 : 1))
      } else {
        f.put(rx + Math.cos(d.angle + t * 0.2) * ringR + d.jitter, ry + Math.sin(d.angle + t * 0.2) * ringR + d.jitter, 3.6, V100, 0.5)
      }
    }
    for (let r = 1; r <= 5; r++) {
      const [x, y, s] = at(r - 1)
      const fl = this.flare[r]
      const dim = active && active !== r ? 0.5 : 1
      f.put(x, y, (46 + 70 * fl) * s, V300, (0.28 + 0.35 * fl) * dim)
      f.put(x, y, (14 + 8 * fl) * s, STAR, dim)
      if (active !== r) continue
      // Light runs left, toward the report, and a ring pulses out.
      const head = (t * 0.9) % 1
      for (let m = 0; m < 26; m++) {
        const k = m / 26
        const u = head - k * 0.25
        if (u < 0) continue
        f.put(x - u * (x + 20), y + Math.sin(u * 3) * 4, 5, k < 0.3 ? STAR : V100, 0.9 * (1 - k))
      }
      const pulse = (t * 1.2) % 1
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2
        f.put(x + Math.cos(ang) * (10 + pulse * 30), y + Math.sin(ang) * (10 + pulse * 30), 3, V100, 0.5 * (1 - pulse))
      }
    }
    f.end()
  }
}
