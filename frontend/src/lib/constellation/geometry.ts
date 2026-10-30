// The recorded run as a shape: question -> 4 searches -> dedupe/rank ring -> 5 sources -> report.
// Searches are never joined to particular sources: that mapping wasn't recorded.
import { DEMO } from "@/lib/research-demo"
import { add, type Curve, type Vec3 } from "./math"

export const QUESTION: Vec3 = [-4.4, 0, 0]
export const RING: Vec3 = [-0.9, 0, 0]
export const RING_RADIUS = 0.42
// Relevance order, matching DEMO.sources.
export const SOURCES: readonly Vec3[] = [
  [1.5, 1.35, -0.9],
  [2.25, 0.65, 0.8],
  [1.8, 0, -0.15],
  [2.45, -0.68, 0.6],
  [1.6, -1.35, -0.8],
]
export const PLANE = { x0: 3.8, x1: 5.5, y0: -0.75, y1: 0.75 } as const

const STREAM_Y = [1.6, 0.55, -0.55, -1.6]
const STREAM_Z = [1.1, -0.7, 0.7, -1.1]
const THREAD_END_Y = [0.55, 0.28, 0, -0.28, -0.55]

export const STREAMS: readonly Curve[] = STREAM_Y.map((y, i) => [
  QUESTION,
  add(QUESTION, 1.3, y, STREAM_Z[i]),
  add(RING, -1.3, y * 0.85, STREAM_Z[i] * 0.8),
  RING,
])

export const SOURCE_PATHS: readonly Curve[] = SOURCES.map((s) => [RING, add(RING, 0.9, 0, 0), add(s, -0.7, 0, 0), s])

export const THREAD_ENDS: readonly Vec3[] = THREAD_END_Y.map((y) => [PLANE.x0, y, 0])

export const THREADS: readonly Curve[] = SOURCES.map((s, i) => [s, add(s, 0.8, 0, 0), add(THREAD_ENDS[i], -0.7, 0, 0), THREAD_ENDS[i]])

export const QUERIES: readonly string[] = DEMO.subQueries
export const DOMAINS: readonly string[] = DEMO.sources.map((s) => s.domain)

if (QUERIES.length !== STREAMS.length || DOMAINS.length !== SOURCES.length) {
  throw new Error(`The constellation draws ${STREAMS.length} searches and ${SOURCES.length} sources; the recorded run has ${QUERIES.length} and ${DOMAINS.length}`)
}
