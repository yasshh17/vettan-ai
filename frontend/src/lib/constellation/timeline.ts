// The six moments of the story, as seconds on the replay clock.
export const STEP_NAMES = ["Question", "Plan", "Search", "Sources", "Write", "Result"] as const
export const STEP_AT = [0, 1.4, 2.8, 4.4, 6.0, 7.6] as const
export const STORY_END = 8.8

// -1 before the replay starts.
export function stepAt(t: number): number {
  let step = -1
  for (let i = 0; i < STEP_AT.length; i++) if (t >= STEP_AT[i]) step = i
  return step
}

// Once the replay has settled the idle loop needs far fewer frames, and after a while none.
export const IDLE_FPS = 24
export type FramePlan = "draw" | "wait" | "stop"

export function framePlan(clock: number, msSinceDraw: number, settleAt: number, stopAt: number): FramePlan {
  if (clock >= stopAt) return "stop"
  if (clock >= settleAt && msSinceDraw < 1000 / IDLE_FPS) return "wait"
  return "draw"
}

// A scroll position inside step `step` (0 at its top, 1 at its bottom) as a story time.
export function storyTime(step: number, local: number): number {
  const i = Math.max(0, Math.min(STEP_AT.length - 1, step))
  const end = i === STEP_AT.length - 1 ? STORY_END : STEP_AT[i + 1]
  const k = local < 0 ? 0 : local > 1 ? 1 : local
  return STEP_AT[i] + k * (end - STEP_AT[i])
}
