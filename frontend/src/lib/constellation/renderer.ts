// Canvas2D renderer for the evidence constellation. Additive soft sprites, no libraries.
// `t` stages the story (what has happened so far); `amb` keeps particles flowing while it holds.
import { portrait, project, viewFor, type CameraPose, type Projected, type View } from "./camera"
import { PLANE, QUESTION, RING, RING_RADIUS, SOURCES, SOURCE_PATHS, STREAMS, THREADS, THREAD_ENDS } from "./geometry"
import { bezier, clamp01, easeOut, type Curve, type Vec3 } from "./math"
import { STAR, V100, V300, V400, V500, type Color, type Particle } from "./particles"

// --color-v-ground. The canvas paints it so the additive glow looks the same everywhere.
const GROUND = "#09090c"

export interface Caption {
  text: string
  at: Vec3
  dx: number
  dy: number
  alpha: number
  color: string
  size: number
  mono?: boolean
  weight?: number
  align?: CanvasTextAlign
}

export interface Frame {
  mode: "hero" | "story"
  t: number
  amb: number
  pose: CameraPose
  fov: number
  portrait?: boolean
  // 1-based source rank to light; 0 for none.
  lit?: number
  // Dim the other sources (the story's Result moment).
  dimOthers?: boolean
  captions?: readonly Caption[]
}

export interface Fonts {
  sans: string
  mono: string
}

export class ConstellationRenderer {
  private ctx: CanvasRenderingContext2D
  private sprites = new Map<string, HTMLCanvasElement>()
  private width = 0
  private height = 0
  private tmp: number[] = [0, 0, 0]

  constructor(
    private canvas: HTMLCanvasElement,
    private particles: readonly Particle[],
    private fonts: Fonts
  ) {
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D is not available")
    this.ctx = ctx
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width
    this.height = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private sprite(c: Color): HTMLCanvasElement {
    const key = c.join(",")
    let cv = this.sprites.get(key)
    if (cv) return cv
    cv = document.createElement("canvas")
    cv.width = cv.height = 64
    const g = cv.getContext("2d")!
    const rgb = `${c[0]},${c[1]},${c[2]}`
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, `rgba(${rgb},1)`)
    gr.addColorStop(0.22, `rgba(${rgb},0.6)`)
    gr.addColorStop(0.5, `rgba(${rgb},0.16)`)
    gr.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = gr
    g.fillRect(0, 0, 64, 64)
    this.sprites.set(key, cv)
    return cv
  }

  draw(f: Frame) {
    const { ctx, width: W, height: H, tmp } = this
    if (!W || !H) return
    const view: View = viewFor(f.pose, H, f.fov)
    const lit = f.lit ?? 0
    const t = f.t
    const amb = f.amb
    const story = f.mode === "story"

    const proj = (x: number, y: number, z: number): Projected | null => {
      if (f.portrait) {
        const p = portrait(x, y, z)
        return project(view, p[0], p[1], p[2], W, H)
      }
      return project(view, x, y, z, W, H)
    }
    const put = (x: number, y: number, z: number, size: number, c: Color, a: number) => {
      if (a <= 0.003) return
      const p = proj(x, y, z)
      if (!p) return
      const px = Math.max(1.4, ((size * view.focal) / p.depth) * 2.2)
      if (p.x < -px || p.x > W + px || p.y < -px || p.y > H + px) return
      ctx.globalAlpha = a > 1 ? 1 : a
      ctx.drawImage(this.sprite(c), p.x - px / 2, p.y - px / 2, px, px)
    }
    const comet = (curve: Curve, head: number, len: number, n: number, bright = 0.85) => {
      if (head <= 0 || head > 1.12) return
      for (let m = 0; m < n; m++) {
        const k = m / n
        const u = head - len * k
        if (u < 0 || u > 1) continue
        bezier(curve, u, tmp)
        put(tmp[0], tmp[1], tmp[2], 0.03, k < 0.3 ? STAR : V100, bright * (1 - k))
      }
      if (head <= 1) {
        bezier(curve, head, tmp)
        put(tmp[0], tmp[1], tmp[2], 0.16, STAR, 0.8)
      }
    }

    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    ctx.fillStyle = GROUND
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = "lighter"

    const gather = easeOut(t / 1.4)
    const ringShown = easeOut((t - 4.0) / 0.6)
    const dimStreams = story ? 1 - 0.55 * clamp01((t - 4.6) / 1.0) : 1
    const write = clamp01((t - 6.0) / 1.5)
    const planeFade = 1 - clamp01((t - 7.7) / 0.6)
    const othersDim = f.dimOthers ? 1 - clamp01((t - 7.6) / 0.6) : 1
    const dustIn = story ? 1 : clamp01(t / 0.8)

    for (const q of this.particles) {
      switch (q.kind) {
        case "dust":
          put(q.base[0] + Math.sin(amb * 0.12 + q.phase) * 0.12, q.base[1] + Math.cos(amb * 0.1 + q.phase) * 0.08, q.base[2], q.size, q.color, q.alpha * dustIn)
          break
        case "core": {
          const k = easeOut((t - q.delay) / 1.0)
          const breathe = 1 + 0.05 * Math.sin(amb * 1.4 + q.delay * 9)
          const hx = QUESTION[0] + q.offset[0] * breathe
          const hy = QUESTION[1] + q.offset[1] * breathe
          const hz = QUESTION[2] + q.offset[2] * breathe
          put(q.start[0] + (hx - q.start[0]) * k, q.start[1] + (hy - q.start[1]) * k, q.start[2] + (hz - q.start[2]) * k, q.size, q.color, q.alpha * (0.25 + 0.75 * k))
          break
        }
        case "stream": {
          const reveal = easeOut((t - 1.4 - q.index * 0.08) / 1.2)
          const u = (q.u0 + q.speed * amb) % 1
          if (u > reveal) break
          bezier(STREAMS[q.index], u, tmp)
          const sd = 0.025 + 0.05 * Math.sin(Math.PI * u)
          put(tmp[0] + q.jitter[0] * sd, tmp[1] + q.jitter[1] * sd, tmp[2] + q.jitter[2] * sd, q.size, q.color, q.alpha * dimStreams)
          break
        }
        case "ring":
          if (q.angle > ringShown * Math.PI * 2) break
          put(RING[0] + Math.cos(q.angle + amb * 0.15) * RING_RADIUS + q.jitter[0], RING[1] + Math.sin(q.angle + amb * 0.15) * RING_RADIUS + q.jitter[1], RING[2] + q.jitter[2], q.size, V100, q.alpha)
          break
        case "toSource": {
          const reveal = easeOut((t - 4.5 - q.index * 0.15) / 0.5)
          const u = (q.u0 + 0.03 * amb) % 1
          if (u > reveal) break
          bezier(SOURCE_PATHS[q.index], u, tmp)
          put(tmp[0] + q.jitter[0], tmp[1] + q.jitter[1], tmp[2] + q.jitter[2], q.size, V400, q.alpha)
          break
        }
        case "thread": {
          const reveal = easeOut((t - 6.0 - q.index * 0.1) / 0.8)
          const u = (q.u0 + 0.05 * amb) % 1
          if (u > reveal) break
          const on = lit === q.index + 1
          const fade = lit && !on ? othersDim : 1
          if (fade <= 0) break
          bezier(THREADS[q.index], u, tmp)
          put(tmp[0] + q.jitter[0], tmp[1] + q.jitter[1], tmp[2] + q.jitter[2], q.size, on ? STAR : V300, on ? 0.75 : q.alpha * fade)
          break
        }
        case "cluster": {
          const ig = easeOut((t - 4.8 - q.index * 0.15) / 0.4)
          if (ig <= 0) break
          const s = SOURCES[q.index]
          const dim = f.dimOthers && lit && lit !== q.index + 1 ? 0.45 : 1
          put(s[0] + q.offset[0] * ig, s[1] + q.offset[1] * ig, s[2] + q.offset[2] * ig, q.size, STAR, q.alpha * ig * dim)
          break
        }
        case "fall": {
          if (t < 4.3) break
          const life = ((amb + q.seed * 3) % 3) / 3
          const fade = clamp01((t - 4.3) / 0.6) * (story ? 1 - clamp01((t - 6.2) / 0.8) : 1)
          put(RING[0] + q.jx * (0.15 + life * 0.9), RING[1] - 0.45 - life * 2.6, RING[2] + q.jz * (0.1 + life * 0.6), q.size, V500, q.alpha * (1 - life) * fade)
          break
        }
        case "line": {
          if (!story) break
          const shown = clamp01(write * 9 - q.row)
          if (shown <= 0 || q.f > shown) break
          const resolved = 1 - q.row / 9
          put(PLANE.x0 + 0.15 + q.f * (PLANE.x1 - PLANE.x0 - 0.3), PLANE.y1 - 0.12 - q.row * 0.15 + q.jy, 0, q.size, q.row === 0 ? STAR : V100, (0.25 + resolved * 0.55) * planeFade)
          break
        }
      }
    }

    // The question's glow, with a flash as it forms.
    put(QUESTION[0], QUESTION[1], QUESTION[2], 2.2, V400, 0.22 * gather)
    put(QUESTION[0], QUESTION[1], QUESTION[2], 0.9, V300, 0.55 * gather)
    put(QUESTION[0], QUESTION[1], QUESTION[2], 0.32, STAR, gather)
    const formed = clamp01((t - 1.0) / 0.7)
    if (formed > 0 && formed < 1) put(QUESTION[0], QUESTION[1], QUESTION[2], 1.6 + 2.4 * formed, V300, 0.32 * (1 - formed))

    // Search: all four streams carry a comet at the same moment.
    if (t >= 2.8 && t < 4.6) {
      const head = story ? (amb % 1.8) / 1.5 : easeOut((t - 2.8) / 1.5) * 1.02
      for (const s of STREAMS) comet(s, head, 0.16, 46)
    }
    if (!story && t > 7.6) {
      const wave = ((t - 7.6) % 4.5) / 1.6
      for (const s of STREAMS) comet(s, wave, 0.16, 40, 0.6)
    }

    put(RING[0], RING[1], RING[2], 1.3, V400, 0.16 * ringShown)
    const closed = clamp01((t - 4.55) / 0.6)
    if (closed > 0 && closed < 1) put(RING[0], RING[1], RING[2], 1.2 + 1.8 * closed, V300, 0.4 * (1 - closed))

    SOURCES.forEach((s, k) => {
      const ig = easeOut((t - 4.8 - k * 0.15) / 0.4)
      if (ig <= 0) return
      const on = lit === k + 1
      const dim = f.dimOthers && lit && !on ? 0.5 : 1
      const pop = story ? 0 : Math.sin(Math.PI * clamp01((t - 4.8 - k * 0.15) / 0.5)) * 0.6
      put(s[0], s[1], s[2], (on ? 1.9 : 1.2) * (ig + pop), V300, (on ? 0.55 : 0.3) * ig * dim)
      put(s[0], s[1], s[2], on ? 0.42 : 0.28, STAR, ig * dim)
      // Ignition: a short flash and a shockwave ring.
      const wave = clamp01((t - 4.8 - k * 0.15) / 0.8)
      if (wave > 0 && wave < 1) {
        put(s[0], s[1], s[2], 1.3 * (1 - wave) + 0.3, STAR, 0.2 * (1 - wave))
        for (let a = 0; a < 28; a++) {
          const ang = (a / 28) * Math.PI * 2
          const rad = 0.08 + wave * 0.62
          put(s[0] + Math.cos(ang) * rad, s[1] + Math.sin(ang) * rad, s[2], 0.05, V100, 0.55 * (1 - wave))
        }
      }
      const thread = THREADS[k]
      if (!story && t >= 6.0 && t < 7.4) comet(thread, easeOut((t - 6.0 - k * 0.1) / 1.2) * 1.05, 0.12, 30)
      if ((story && t >= 6.0 && (!f.dimOthers || !lit || on)) || (!story && t >= 7.4)) {
        const start = story ? 0 : 7.4
        const loop = ((amb - start + k * 0.6) % (on ? 1.4 : story ? 2.6 : 3.2)) / (on ? 1.0 : 1.4)
        if (loop < 1.1) comet(thread, loop, 0.12, on ? 34 : 24, on ? 1 : story ? 0.6 : 0.45)
      }
      if (!story) {
        const land = clamp01((t - 7.15 - k * 0.1) / 0.6)
        const end = THREAD_ENDS[k]
        if (land > 0 && land < 1) put(end[0], end[1], end[2], 0.25 + 0.45 * land, STAR, 0.32 * (1 - land))
      }
    })
    if (story && write > 0) put((PLANE.x0 + PLANE.x1) / 2, 0, -0.1, 3.4, V500, 0.1 * write * planeFade)

    if (f.captions?.length) this.drawCaptions(f.captions, proj)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = "source-over"
  }

  private drawCaptions(captions: readonly Caption[], proj: (x: number, y: number, z: number) => Projected | null) {
    const { ctx } = this
    ctx.globalCompositeOperation = "source-over"
    ctx.shadowColor = "#09090c"
    ctx.shadowBlur = 8
    ctx.textBaseline = "middle"
    for (const c of captions) {
      if (c.alpha <= 0.01) continue
      const p = proj(c.at[0], c.at[1], c.at[2])
      if (!p) continue
      ctx.globalAlpha = clamp01(c.alpha)
      ctx.fillStyle = c.color
      ctx.font = `${c.weight ?? 400} ${c.size}px ${c.mono ? this.fonts.mono : this.fonts.sans}`
      ctx.textAlign = c.align ?? "left"
      const x = Math.min(this.width - 6, Math.max(6, p.x + c.dx))
      // Twice, so the dark halo holds up over bright stars and streams.
      ctx.fillText(c.text, x, p.y + c.dy)
      ctx.fillText(c.text, x, p.y + c.dy)
    }
    ctx.shadowBlur = 0
  }
}
