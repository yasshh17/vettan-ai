// @vitest-environment node
import { describe, expect, it } from "vitest"
import canvas from "./fixtures/canvas-v62-poses.json"
import { STAGE_POSES, isShown, poseStyle, type StageLayer } from "@/components/landing-v2/story/stage-poses"

// The fixture is the STAGE table copied verbatim from the approved v62 canvas (Main.dc.html).
const STAGE = canvas.STAGE as Record<string, string>[]

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

function parseCss(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":")
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
  }
  return out
}

function styleToCss(style: React.CSSProperties): Record<string, string> {
  return Object.fromEntries(Object.entries(style).map(([k, v]) => [kebab(k), String(v)]))
}

const layers = Object.keys(STAGE_POSES) as StageLayer[]

describe("story stage poses match the approved v62 canvas", () => {
  it("covers exactly the canvas layers, six moments each", () => {
    expect(STAGE).toHaveLength(6)
    STAGE.forEach((pose) => expect(Object.keys(pose).sort()).toEqual([...layers].sort()))
    layers.forEach((l) => expect(STAGE_POSES[l]).toHaveLength(6))
  })

  it.each(STAGE.map((pose, moment) => [moment, pose] as const))(
    "moment %i: every layer's transform, opacity, visibility and transition are identical",
    (moment, pose) => {
      for (const layer of layers) {
        expect(styleToCss(poseStyle(layer, moment)), `${layer} @ ${moment}`).toEqual(parseCss(pose[layer]))
      }
    }
  )

  it("Plan → Search moves the same four cards instead of listing them again", () => {
    for (let i = 0; i < 4; i++) {
      const layer = `sub${i}` as StageLayer
      expect(isShown(layer, 1)).toBe(true)
      expect(isShown(layer, 2)).toBe(true)
      expect(STAGE_POSES[layer][1].t).toBe(`translate(120px,${112 + i * 62}px) scale(1)`)
      expect(STAGE_POSES[layer][2].t).toBe(`translate(0px,${112 + i * 62}px) scale(1)`)
      // Done appears at 950ms, after the 0.9s progress line.
      expect(poseStyle(`subchk${i}` as StageLayer, 2).transition).toBe("opacity .3s ease 950ms")
    }
    expect(poseStyle("bandDone", 2).transition).toBe("opacity .3s ease 950ms")
  })

  it("Write ends with five monograms and threads into the report, no stacked source cards", () => {
    for (let i = 0; i < 5; i++) {
      expect(isShown(`src${i}` as StageLayer, 4)).toBe(false)
      expect(isShown(`mono${i}` as StageLayer, 4)).toBe(true)
      expect(STAGE_POSES[`th${i}` as StageLayer][4]).toMatchObject({ x: 0, o: 0.6, d: 100 + i * 50 })
    }
    expect(isShown("rep", 4)).toBe(true)
    expect(isShown("repSk", 4)).toBe(true)
    expect(isShown("repCt", 4)).toBe(false)
  })

  it("Result shows the report alone: monograms and threads have cleared", () => {
    for (let i = 0; i < 5; i++) {
      expect(isShown(`mono${i}` as StageLayer, 5)).toBe(false)
      expect(STAGE_POSES[`th${i}` as StageLayer][5].o).toBe(0)
    }
    expect(STAGE_POSES.rep[5]).toMatchObject({ t: "translate(20px,92px) scale(1)", o: 1, v: 1 })
    expect(isShown("repCt", 5)).toBe(true)
  })

  it("Sources steps the searches back with a 32px gap and drops the search paths", () => {
    for (let i = 0; i < 4; i++) {
      expect(STAGE_POSES[`sub${i}` as StageLayer][3]).toMatchObject({ t: `translate(-14px,${112 + i * 62}px) scale(0.9)`, o: 0.45 })
      expect(STAGE_POSES[`br${i}` as StageLayer][3].o).toBe(0)
    }
    // A 280px card scaled 0.9 about its centre and moved −14px ends at 252px; sources start at 284px.
    const searchRight = -14 + 140 + (280 * 0.9) / 2
    expect(searchRight).toBe(252)
    expect(STAGE_POSES.src0[3].t).toBe("translate(284px,112px) scale(1)")
    expect(284 - searchRight).toBe(32)
  })
})
