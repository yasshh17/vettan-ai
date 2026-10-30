import { smoothstep, type Vec3 } from "./math"

export interface CameraPose {
  pos: Vec3
  look: Vec3
}

export interface CameraKey extends CameraPose {
  t: number
}

export interface View {
  pos: Vec3
  forward: Vec3
  right: Vec3
  up: Vec3
  // Pixels per world unit at distance 1.
  focal: number
}

export interface Projected {
  x: number
  y: number
  depth: number
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

// Same convention as three.js lookAt with +Y up, so poses carry over from the renders.
export function viewFor(pose: CameraPose, height: number, fovDeg: number): View {
  const forward = norm([pose.look[0] - pose.pos[0], pose.look[1] - pose.pos[1], pose.look[2] - pose.pos[2]])
  const right = norm([-forward[2], 0, forward[0]])
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  return { pos: pose.pos, forward, right, up, focal: height / 2 / Math.tan((fovDeg * Math.PI) / 360) }
}

export function project(view: View, x: number, y: number, z: number, width: number, height: number): Projected | null {
  const dx = x - view.pos[0]
  const dy = y - view.pos[1]
  const dz = z - view.pos[2]
  const depth = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2]
  if (depth < 0.2) return null
  return {
    x: width / 2 + ((dx * view.right[0] + dy * view.right[1] + dz * view.right[2]) * view.focal) / depth,
    y: height / 2 - ((dx * view.up[0] + dy * view.up[1] + dz * view.up[2]) * view.focal) / depth,
    depth,
  }
}

// A quarter turn so the pipeline reads top to bottom on a phone.
export const portrait = (x: number, y: number, z: number): Vec3 => [y, -x, z]

export function poseAt(keys: readonly CameraKey[], t: number): CameraPose {
  if (t <= keys[0].t) return keys[0]
  const last = keys[keys.length - 1]
  if (t >= last.t) return last
  let i = 0
  while (t > keys[i + 1].t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const k = smoothstep((t - a.t) / (b.t - a.t))
  const mix = (p: Vec3, q: Vec3): Vec3 => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]
  return { pos: mix(a.pos, b.pos), look: mix(a.look, b.look) }
}
