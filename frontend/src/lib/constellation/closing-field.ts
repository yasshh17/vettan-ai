// The closing call to action's backdrop: five sources drifting around the headline, with light
// flowing from each toward the question field.
import { FlatField } from "./flat"
import { gaussian, rng } from "./math"
import { STAR, V300, V400 } from "./particles"

// Fractions of the section: where the five sources float, and where the field sits.
const STARS = [[0.18, 0.29], [0.29, 0.77], [0.78, 0.17], [0.82, 0.71], [0.5, 0.11]] as const
const FIELD = [0.5, 0.64] as const
const GROUND = "#09090c"

type Dot =
  | { kind: "dust"; x: number; y: number; phase: number; size: number; alpha: number }
  | { kind: "star"; index: number; ox: number; oy: number; size: number }
  | { kind: "flow"; index: number; u: number; jitter: number; size: number }

export class ClosingField {
  readonly field: FlatField
  private dots: Dot[] = []

  constructor(canvas: HTMLCanvasElement, scale: number) {
    this.field = new FlatField(canvas)
    const random = rng(21)
    const randn = gaussian(random)
    const n = (count: number) => Math.round(count * scale)
    for (let i = 0; i < n(700); i++)
      this.dots.push({ kind: "dust", x: random(), y: random(), phase: random() * 6.28, size: 1 + random() * 1.8, alpha: 0.04 + random() * 0.18 })
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < n(80); i++) this.dots.push({ kind: "star", index: k, ox: randn() * 7, oy: randn() * 7, size: 2 + random() * 1.6 })
      for (let i = 0; i < n(90); i++) this.dots.push({ kind: "flow", index: k, u: random(), jitter: randn() * 2, size: 1.6 + random() })
    }
  }

  resize(width: number, height: number, dpr: number) {
    this.field.resize(width, height, dpr)
  }

  draw(t: number) {
    const f = this.field
    const W = f.width
    const H = f.height
    if (!W || !H) return
    const pos = (k: number) => [STARS[k][0] * W + Math.sin(t * 0.25 + k * 1.7) * 14, STARS[k][1] * H + Math.cos(t * 0.21 + k) * 10] as const
    const fx = FIELD[0] * W
    const fy = FIELD[1] * H
    f.begin(GROUND)
    for (const d of this.dots) {
      if (d.kind === "dust") f.put(d.x * W + Math.sin(t * 0.15 + d.phase) * 6, d.y * H + Math.cos(t * 0.12 + d.phase) * 4, d.size * 2.2, V300, d.alpha)
      else if (d.kind === "star") {
        const [x, y] = pos(d.index)
        f.put(x + d.ox, y + d.oy, d.size * 2.4, STAR, 0.45)
      } else {
        const [x, y] = pos(d.index)
        const u = (d.u + t * 0.06) % 1
        f.put(x + (fx - x) * u, y + (fy - y) * u - Math.sin(u * Math.PI) * 40 + d.jitter, d.size * 2, V400, 0.22 * Math.sin(u * Math.PI))
      }
    }
    for (let k = 0; k < 5; k++) {
      const [x, y] = pos(k)
      f.put(x, y, 70 * (0.85 + 0.15 * Math.sin(t * 2 + k * 2.1)), V300, 0.3)
      f.put(x, y, 16, STAR, 1)
    }
    f.end()
  }
}
