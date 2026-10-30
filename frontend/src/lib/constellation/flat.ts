// Flat (screen-space) glow drawing for the small scenes: the report's source map and the
// closing call to action. Same soft sprites as the 3D constellation, without the camera.
import type { Color } from "./particles"

export class FlatField {
  private ctx: CanvasRenderingContext2D
  private sprites = new Map<string, HTMLCanvasElement>()
  width = 0
  height = 0

  constructor(private canvas: HTMLCanvasElement) {
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

  begin(ground: string) {
    const { ctx } = this
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.globalCompositeOperation = "lighter"
  }

  put(x: number, y: number, px: number, c: Color, a: number) {
    if (a <= 0.003) return
    this.ctx.globalAlpha = a > 1 ? 1 : a
    this.ctx.drawImage(this.sprite(c), x - px / 2, y - px / 2, px, px)
  }

  end() {
    this.ctx.globalAlpha = 1
    this.ctx.globalCompositeOperation = "source-over"
  }
}
