// @vitest-environment node
import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { DEFAULT_VOICE, VOICES } from "@/lib/voices"

describe("voices", () => {
  it("lists the six voices the report player offers, with nova first", () => {
    expect(Object.keys(VOICES)).toEqual(["nova", "alloy", "echo", "fable", "onyx", "shimmer"])
    expect(DEFAULT_VOICE).toBe("nova")
  })

  it("is the player's only voice list, so the landing page can't drift from it", () => {
    const player = readFileSync(path.resolve(__dirname, "../../components/research/audio-player.tsx"), "utf8")
    expect(player).toContain('from "@/lib/voices"')
    expect(player).not.toMatch(/const VOICES\s*=/)
  })
})
