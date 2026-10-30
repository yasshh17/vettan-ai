// @vitest-environment node
import { describe, expect, it } from "vitest"
import { DEMO } from "@/lib/research-demo"
import { portrait, poseAt, project, viewFor } from "@/lib/constellation/camera"
import { DOMAINS, QUERIES, RING, SOURCES, SOURCE_PATHS, STREAMS, THREADS, QUESTION } from "@/lib/constellation/geometry"
import { bezier, easeOut, rng, smoothstep } from "@/lib/constellation/math"
import { buildParticles, pickTier, TIER_SCALE } from "@/lib/constellation/particles"
import { IDLE_FPS, STEP_AT, STEP_NAMES, STORY_END, framePlan, stepAt, storyTime } from "@/lib/constellation/timeline"

describe("camera", () => {
  const pose = { pos: [0, 0, 10] as const, look: [0, 0, 0] as const }

  it("puts the point it looks at in the middle of the frame", () => {
    const view = viewFor(pose, 600, 40)
    const p = project(view, 0, 0, 0, 800, 600)!
    expect(p.x).toBeCloseTo(400)
    expect(p.y).toBeCloseTo(300)
    expect(p.depth).toBeCloseTo(10)
  })

  it("keeps world right on screen right and world up on screen up", () => {
    const view = viewFor(pose, 600, 40)
    expect(project(view, 1, 0, 0, 800, 600)!.x).toBeGreaterThan(400)
    expect(project(view, 0, 1, 0, 800, 600)!.y).toBeLessThan(300)
  })

  it("drops points behind the camera", () => {
    expect(project(viewFor(pose, 600, 40), 0, 0, 20, 800, 600)).toBeNull()
  })

  it("turns the scene a quarter turn for phones", () => {
    expect(portrait(-4.4, 0, 0)).toEqual([0, 4.4, 0])
  })

  it("eases between keyframes and holds at either end", () => {
    const keys = [
      { t: 0, pos: [0, 0, 10] as const, look: [0, 0, 0] as const },
      { t: 2, pos: [4, 0, 10] as const, look: [2, 0, 0] as const },
    ]
    expect(poseAt(keys, -1).pos[0]).toBe(0)
    expect(poseAt(keys, 9).pos[0]).toBe(4)
    expect(poseAt(keys, 1).pos[0]).toBeCloseTo(2)
    expect(poseAt(keys, 0.5).pos[0]).toBeCloseTo(4 * smoothstep(0.25))
  })
})

describe("timeline", () => {
  it("names six moments in order", () => {
    expect(STEP_NAMES).toEqual(["Question", "Plan", "Search", "Sources", "Write", "Result"])
    expect([...STEP_AT].sort((a, b) => a - b)).toEqual([...STEP_AT])
  })

  it("reports the moment for a replay time", () => {
    expect(stepAt(-0.1)).toBe(-1)
    expect(stepAt(0)).toBe(0)
    expect(stepAt(2.9)).toBe(2)
    expect(stepAt(99)).toBe(5)
  })

  it("maps scroll inside a step to a time inside that moment", () => {
    expect(storyTime(0, 0)).toBe(0)
    expect(storyTime(2, 0.5)).toBeCloseTo((STEP_AT[2] + STEP_AT[3]) / 2)
    expect(storyTime(5, 1)).toBe(STORY_END)
    expect(storyTime(9, 2)).toBe(STORY_END)
  })

  it("slows the idle loop once the replay settles, then stops it", () => {
    const settle = STORY_END + 4
    expect(framePlan(3, 16, settle, 60)).toBe("draw")
    expect(framePlan(settle + 1, 16, settle, 60)).toBe("wait")
    expect(framePlan(settle + 1, 1000 / IDLE_FPS, settle, 60)).toBe("draw")
    expect(framePlan(60, 100, settle, 60)).toBe("stop")
  })
})

describe("geometry", () => {
  it("uses the recorded run's words, not its own", () => {
    expect(QUERIES).toEqual(DEMO.subQueries)
    expect(DOMAINS).toEqual(DEMO.sources.map((s) => s.domain))
  })

  it("joins every search to the ring, not to a particular source", () => {
    for (const s of STREAMS) {
      expect(s[0]).toEqual(QUESTION)
      expect(s[3]).toEqual(RING)
    }
    SOURCE_PATHS.forEach((p, i) => {
      expect(p[0]).toEqual(RING)
      expect(p[3]).toEqual(SOURCES[i])
    })
    THREADS.forEach((th, i) => expect(th[0]).toEqual(SOURCES[i]))
  })

  it("evaluates curves at their ends", () => {
    const out = [0, 0, 0]
    expect(bezier(STREAMS[0], 0, out)).toEqual([...QUESTION])
    expect(bezier(STREAMS[0], 1, out).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([...RING])
  })
})

describe("particles", () => {
  it("picks lighter budgets for small or slow devices", () => {
    expect(pickTier({ width: 1440, cores: 8 })).toBe("desktop")
    expect(pickTier({ width: 900, cores: 8 })).toBe("tablet")
    expect(pickTier({ width: 390, cores: 8 })).toBe("phone")
    expect(pickTier({ width: 1440, cores: 4 })).toBe("low")
    expect(pickTier({ width: 1440, cores: 8, saveData: true })).toBe("low")
    expect(TIER_SCALE.desktop).toBeGreaterThan(TIER_SCALE.tablet)
    expect(TIER_SCALE.phone).toBeGreaterThan(TIER_SCALE.low)
  })

  it("stays within budget and scales down by tier", () => {
    const full = buildParticles(TIER_SCALE.desktop).length
    const low = buildParticles(TIER_SCALE.low).length
    expect(full).toBeLessThanOrEqual(10_500)
    expect(low).toBeLessThan(full * 0.4)
  })

  it("is the same scene on every load", () => {
    expect(buildParticles(0.2, 7)).toEqual(buildParticles(0.2, 7))
  })

  it("has a seeded random stream and an ease that ends at 1", () => {
    const a = rng(3)
    const b = rng(3)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(easeOut(1)).toBe(1)
    expect(easeOut(-2)).toBe(0)
  })
})
