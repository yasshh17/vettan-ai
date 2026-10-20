import { afterEach, describe, expect, it, vi } from "vitest"
import {
  HEADER_GAP,
  centerCitationY,
  clearance,
  headerClearance,
  revealDelta,
  scrollerFor,
  showLessDelta,
} from "@/lib/scroll-clearance"

// The header measured 65px at every width in the canvas audit; the math takes any height.
const HEADER = 65
const CLEAR = clearance(HEADER)

describe("clearance line", () => {
  it("is the measured header height plus 16px", () => {
    expect(CLEAR).toBe(81)
    expect(clearance(72)).toBe(88)
  })

  it("reads the header from the page instead of assuming it", () => {
    document.body.innerHTML = `<header data-lv2-header></header>`
    const header = document.querySelector("header")!
    header.getBoundingClientRect = () => ({ height: 72 }) as DOMRect
    expect(headerClearance()).toBe(72 + HEADER_GAP)
    document.body.innerHTML = ""
  })
})

describe("revealDelta", () => {
  it("does nothing when the card is fully visible below the line", () => {
    expect(revealDelta({ top: 200, bottom: 400 }, CLEAR, 0, 900)).toBe(0)
  })

  it("brings a card hidden under the header down to the line", () => {
    expect(revealDelta({ top: 40, bottom: 240 }, CLEAR, 0, 900)).toBe(40 - CLEAR)
  })

  it("brings a card below the fold up to the line", () => {
    expect(revealDelta({ top: 820, bottom: 1020 }, CLEAR, 0, 900)).toBe(820 - CLEAR)
  })
})

describe("centerCitationY", () => {
  it("centres the citation in the space below the header", () => {
    expect(centerCitationY(CLEAR, 900, 20)).toBe(Math.round((900 + CLEAR - 20) / 2))
  })

  it("never puts it above the clearance line", () => {
    expect(centerCitationY(CLEAR, 100, 400)).toBe(CLEAR)
  })
})

// After the collapse: heading position and toggle position as rendered, viewport [0, h].
describe("showLessDelta (v62 rule)", () => {
  // Heading-to-toggle distance in the collapsed state grows as the column narrows.
  const cases = [
    { size: "1440×900", h: 900, heading: -1400, toggle: -1400 + 520 },
    { size: "1024×768", h: 768, heading: -1600, toggle: -1600 + 560 },
    { size: "768×1024", h: 1024, heading: -2000, toggle: -2000 + 600 },
    { size: "390×844", h: 844, heading: -2600, toggle: -2600 + 700 },
  ]

  it.each(cases)("$size: puts the heading on the clearance line and keeps the toggle in view", ({ h, heading, toggle }) => {
    const delta = showLessDelta({ top: heading, bottom: heading + 40 }, { top: toggle, bottom: toggle + 44 }, 0, h, CLEAR)
    expect(heading - delta).toBe(CLEAR)
    const toggleTop = toggle - delta
    expect(toggleTop).toBeGreaterThanOrEqual(CLEAR)
    expect(toggleTop + 44).toBeLessThanOrEqual(h - HEADER_GAP)
  })

  it("360×780: when both can't fit, the focused toggle wins and the heading slides under the header", () => {
    const h = 780
    const heading = -3000
    const toggle = heading + 760 // section label, title and excerpt push the toggle far below
    const delta = showLessDelta({ top: heading, bottom: heading + 34 }, { top: toggle, bottom: toggle + 44 }, 0, h, CLEAR)
    const toggleTop = toggle - delta
    expect(toggleTop + 44).toBe(h - HEADER_GAP)
    expect(toggleTop).toBeGreaterThanOrEqual(CLEAR)
    expect(heading - delta).toBeLessThan(CLEAR)
  })

  it("never leaves the toggle under the header", () => {
    const delta = showLessDelta({ top: -500, bottom: -460 }, { top: 2000, bottom: 2600 }, 0, 600, CLEAR)
    expect(2000 - delta).toBe(CLEAR)
  })

  it("doesn't move a heading that's already below the line", () => {
    expect(showLessDelta({ top: 300, bottom: 340 }, { top: 500, bottom: 544 }, 0, 900, CLEAR)).toBe(0)
  })
})

describe("scrollerFor", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  function scrollable(el: HTMLElement) {
    Object.defineProperty(el, "scrollHeight", { value: 2000 })
    Object.defineProperty(el, "clientHeight", { value: 500 })
  }

  it("finds a nested scrolling container so embedded pages still scroll correctly", () => {
    document.body.innerHTML = `<div id="outer" style="overflow-y:auto"><div><p id="target">x</p></div></div>`
    const outer = document.getElementById("outer")!
    scrollable(outer)
    expect(scrollerFor(document.getElementById("target")!)).toBe(outer)
  })

  it("skips the sources panel, which scrolls on its own", () => {
    document.body.innerHTML = `<div id="page" style="overflow-y:auto"><aside data-lv2-own-scroll style="overflow-y:auto"><li id="target"></li></aside></div>`
    const page = document.getElementById("page")!
    scrollable(page)
    scrollable(document.querySelector("aside")!)
    expect(scrollerFor(document.getElementById("target")!)).toBe(page)
  })

  it("returns null when the window is the scroller", () => {
    document.body.innerHTML = `<div><p id="target">x</p></div>`
    expect(scrollerFor(document.getElementById("target")!)).toBeNull()
  })
})
