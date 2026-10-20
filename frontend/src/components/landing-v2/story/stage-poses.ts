// Ported from the approved v62 canvas (Vettan Landing, Main.dc.html STAGE table).
// One pose per story moment. t: transform, o: opacity, v: visible, x: stroke-dashoffset,
// d: delay in ms. Transitions are rebuilt per layer kind in poseStyle.
import type { CSSProperties } from "react"

export interface Pose {
  t?: string
  o: number
  v?: 0 | 1
  x?: number
  d?: number
}

const EASE = "cubic-bezier(.22,1,.36,1)"

const POSES = {
  q: [
    { t: "translate(0px,170px) scale(1)", o: 1, v: 1 },
    { t: "translate(0px,0px) scale(0.94)", o: 1, v: 1 },
    { t: "translate(0px,0px) scale(0.94)", o: 1, v: 1 },
    { t: "translate(0px,0px) scale(0.94)", o: 0.55, v: 1 },
    { t: "translate(0px,0px) scale(0.94)", o: 0.55, v: 1 },
    { t: "translate(0px,0px) scale(0.94)", o: 0.55, v: 1 },
  ],
  sub0: [
    { t: "translate3d(120px,126px,0px) rotateX(12deg) scale(1)", o: 0, v: 0 },
    { t: "translate(120px,112px) scale(1)", o: 1, v: 1 },
    { t: "translate(0px,112px) scale(1)", o: 1, v: 1 },
    { t: "translate(-14px,112px) scale(0.9)", o: 0.45, v: 1 },
    { t: "translate(-14px,112px) scale(0.9)", o: 0.12, v: 0 },
    { t: "translate(-14px,112px) scale(0.9)", o: 0.12, v: 0 },
  ],
  subchk0: [
    { o: 0 },
    { o: 0 },
    { o: 1, d: 950 },
    { o: 1 },
    { o: 1 },
    { o: 1 },
  ],
  br0: [
    { o: 0, x: 320 },
    { o: 0, x: 320 },
    { o: 0.9, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
  ],
  sub1: [
    { t: "translate3d(120px,188px,0px) rotateX(12deg) scale(1)", o: 0, v: 0 },
    { t: "translate(120px,174px) scale(1)", o: 1, v: 1, d: 70 },
    { t: "translate(0px,174px) scale(1)", o: 1, v: 1 },
    { t: "translate(-14px,174px) scale(0.9)", o: 0.45, v: 1 },
    { t: "translate(-14px,174px) scale(0.9)", o: 0.12, v: 0 },
    { t: "translate(-14px,174px) scale(0.9)", o: 0.12, v: 0 },
  ],
  subchk1: [
    { o: 0 },
    { o: 0 },
    { o: 1, d: 950 },
    { o: 1 },
    { o: 1 },
    { o: 1 },
  ],
  br1: [
    { o: 0, x: 320 },
    { o: 0, x: 320 },
    { o: 0.9, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
  ],
  sub2: [
    { t: "translate3d(120px,250px,0px) rotateX(12deg) scale(1)", o: 0, v: 0 },
    { t: "translate(120px,236px) scale(1)", o: 1, v: 1, d: 140 },
    { t: "translate(0px,236px) scale(1)", o: 1, v: 1 },
    { t: "translate(-14px,236px) scale(0.9)", o: 0.45, v: 1 },
    { t: "translate(-14px,236px) scale(0.9)", o: 0.12, v: 0 },
    { t: "translate(-14px,236px) scale(0.9)", o: 0.12, v: 0 },
  ],
  subchk2: [
    { o: 0 },
    { o: 0 },
    { o: 1, d: 950 },
    { o: 1 },
    { o: 1 },
    { o: 1 },
  ],
  br2: [
    { o: 0, x: 320 },
    { o: 0, x: 320 },
    { o: 0.9, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
  ],
  sub3: [
    { t: "translate3d(120px,312px,0px) rotateX(12deg) scale(1)", o: 0, v: 0 },
    { t: "translate(120px,298px) scale(1)", o: 1, v: 1, d: 210 },
    { t: "translate(0px,298px) scale(1)", o: 1, v: 1 },
    { t: "translate(-14px,298px) scale(0.9)", o: 0.45, v: 1 },
    { t: "translate(-14px,298px) scale(0.9)", o: 0.12, v: 0 },
    { t: "translate(-14px,298px) scale(0.9)", o: 0.12, v: 0 },
  ],
  subchk3: [
    { o: 0 },
    { o: 0 },
    { o: 1, d: 950 },
    { o: 1 },
    { o: 1 },
    { o: 1 },
  ],
  br3: [
    { o: 0, x: 320 },
    { o: 0, x: 320 },
    { o: 0.9, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
    { o: 0, x: 0 },
  ],
  band: [
    { t: "translate(12px,0px) scale(1)", o: 0, v: 0 },
    { t: "translate(12px,0px) scale(1)", o: 0, v: 0 },
    { t: "translate(0px,0px) scale(1)", o: 1, v: 1, d: 250 },
    { t: "translate(12px,0px) scale(1)", o: 0, v: 0 },
    { t: "translate(12px,0px) scale(1)", o: 0, v: 0 },
    { t: "translate(12px,0px) scale(1)", o: 0, v: 0 },
  ],
  src0: [
    { t: "translate(284px,130px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,130px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,130px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,112px) scale(1)", o: 1, v: 1 },
    { t: "translate(292px,112px) scale(0.92)", o: 0, v: 0 },
    { t: "translate(274px,300px) scale(0.85)", o: 0, v: 0 },
  ],
  th0: [
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0.6, x: 0, d: 100 },
    { o: 0, x: 260 },
  ],
  src1: [
    { t: "translate(284px,196px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,196px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,196px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,178px) scale(1)", o: 1, v: 1, d: 80 },
    { t: "translate(292px,158px) scale(0.92)", o: 0, v: 0 },
    { t: "translate(274px,300px) scale(0.85)", o: 0, v: 0 },
  ],
  th1: [
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0.6, x: 0, d: 150 },
    { o: 0, x: 260 },
  ],
  src2: [
    { t: "translate(284px,262px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,262px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,262px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,244px) scale(1)", o: 1, v: 1, d: 160 },
    { t: "translate(292px,204px) scale(0.92)", o: 0, v: 0 },
    { t: "translate(274px,300px) scale(0.85)", o: 0, v: 0 },
  ],
  th2: [
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0.6, x: 0, d: 200 },
    { o: 0, x: 260 },
  ],
  src3: [
    { t: "translate(284px,328px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,328px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,328px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,310px) scale(1)", o: 1, v: 1, d: 240 },
    { t: "translate(292px,250px) scale(0.92)", o: 0, v: 0 },
    { t: "translate(274px,300px) scale(0.85)", o: 0, v: 0 },
  ],
  th3: [
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0.6, x: 0, d: 250 },
    { o: 0, x: 260 },
  ],
  src4: [
    { t: "translate(284px,394px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,394px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,394px) scale(1)", o: 0, v: 0 },
    { t: "translate(284px,376px) scale(1)", o: 1, v: 1, d: 320 },
    { t: "translate(292px,296px) scale(0.92)", o: 0, v: 0 },
    { t: "translate(274px,300px) scale(0.85)", o: 0, v: 0 },
  ],
  th4: [
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0, x: 260 },
    { o: 0.6, x: 0, d: 300 },
    { o: 0, x: 260 },
  ],
  rep: [
    { t: "translate(20px,150px) scale(0.46)", o: 0, v: 0 },
    { t: "translate(20px,150px) scale(0.46)", o: 0, v: 0 },
    { t: "translate(20px,150px) scale(0.46)", o: 0, v: 0 },
    { t: "translate(20px,150px) scale(0.46)", o: 0, v: 0 },
    { t: "translate(20px,150px) scale(0.46)", o: 1, v: 1 },
    { t: "translate(20px,92px) scale(1)", o: 1, v: 1 },
  ],
  repSk: [
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 1, v: 1 },
    { o: 0, v: 0 },
  ],
  repCt: [
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 1, v: 1, d: 200 },
  ],
  subbar0: [
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(1)", o: 1 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
  ],
  subbar1: [
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(1)", o: 1 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
  ],
  subbar2: [
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(1)", o: 1 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
  ],
  subbar3: [
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(0)", o: 0 },
    { t: "scaleX(1)", o: 1 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
    { t: "scaleX(1)", o: 0 },
  ],
  bandDone: [
    { o: 0 },
    { o: 0 },
    { o: 1, d: 950 },
    { o: 0 },
    { o: 0 },
    { o: 0 },
  ],
  mono0: [
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 1, v: 1, d: 100 },
    { o: 0, v: 0 },
  ],
  mono1: [
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 1, v: 1, d: 150 },
    { o: 0, v: 0 },
  ],
  mono2: [
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 1, v: 1, d: 200 },
    { o: 0, v: 0 },
  ],
  mono3: [
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 1, v: 1, d: 250 },
    { o: 0, v: 0 },
  ],
  mono4: [
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 0, v: 0 },
    { o: 1, v: 1, d: 300 },
    { o: 0, v: 0 },
  ],
} satisfies Record<string, Pose[]>

export type StageLayer = keyof typeof POSES
export const STAGE_POSES: Record<StageLayer, Pose[]> = POSES

const kindOf = (layer: string) => layer.replace(/\d+$/, "")

export function poseStyle(layer: StageLayer, moment: number): CSSProperties {
  const p: Pose = STAGE_POSES[layer][moment]
  const d = p.d ?? 0
  const vis = p.v ? "visible" : "hidden"
  switch (kindOf(layer)) {
    case "q":
    case "sub":
    case "band":
    case "src":
    case "rep":
      return {
        transform: p.t,
        opacity: p.o,
        visibility: vis,
        transition: `transform .55s ${EASE} ${d}ms, opacity .55s ${EASE} ${d}ms, visibility 0s linear ${p.v ? d : 550}ms`,
      }
    case "subchk":
    case "bandDone":
      return { opacity: p.o, transition: `opacity .3s ease ${d}ms` }
    case "br":
    case "th":
      return {
        strokeDasharray: kindOf(layer) === "br" ? 320 : 260,
        strokeDashoffset: p.x,
        opacity: p.o,
        transition: `stroke-dashoffset .9s ${EASE} ${d}ms, opacity .45s ease ${d}ms`,
      }
    case "subbar":
      return { transform: p.t, opacity: p.o, transition: `transform .9s ${EASE}, opacity .3s ease` }
    case "mono":
      return p.v
        ? { opacity: p.o, visibility: vis, transition: `opacity .45s ease ${d}ms, visibility 0s linear ${d}ms` }
        : { opacity: p.o, visibility: vis, transition: "opacity .3s ease 0ms, visibility 0s linear 300ms" }
    case "repSk":
      return { opacity: p.o, visibility: vis, transition: "opacity .45s ease" }
    case "repCt":
      return { opacity: p.o, visibility: vis, transition: `opacity .45s ease ${d}ms` }
    default:
      throw new Error(`Unknown stage layer ${layer}`)
  }
}

// A layer that's hidden in this moment leaves the tab order and the accessibility tree.
export function isShown(layer: StageLayer, moment: number): boolean {
  const p: Pose = STAGE_POSES[layer][moment]
  return p.v === undefined ? p.o > 0 : p.v === 1
}
