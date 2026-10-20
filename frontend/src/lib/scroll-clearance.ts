// Every scroll the landing page makes on the reader's behalf lands below the sticky header.
// The header is measured on each action; nothing assumes its height.
export const HEADER_GAP = 16

export interface Edges {
  top: number
  bottom: number
}

export function clearance(headerHeight: number, gap = HEADER_GAP): number {
  return headerHeight + gap
}

// How far to scroll so an element's top sits on the clearance line, or 0 when it's already
// fully visible below the header.
export function revealDelta(el: Edges, clear: number, viewTop: number, viewBottom: number): number {
  if (el.top - viewTop >= clear && el.bottom <= viewBottom) return 0
  return el.top - viewTop - clear
}

// Where a citation should land: centred in the space below the header, never above the line.
export function centerCitationY(clear: number, viewHeight: number, citationHeight: number): number {
  return Math.max(clear, Math.round((viewHeight + clear - citationHeight) / 2))
}

// After "Show less": put the section heading on the clearance line, unless that pushes the
// focused toggle below the fold, in which case the toggle wins. It never ends under the header.
export function showLessDelta(heading: Edges, toggle: Edges, viewTop: number, viewBottom: number, clear: number): number {
  let delta = 0
  if (heading.top - viewTop < clear) delta = heading.top - viewTop - clear
  if (toggle.bottom - delta > viewBottom - HEADER_GAP) delta = toggle.bottom - (viewBottom - HEADER_GAP)
  if (toggle.top - delta - viewTop < clear) delta = toggle.top - viewTop - clear
  return delta
}

export function headerClearance(doc: Document = document): number {
  const header = doc.querySelector("[data-lv2-header]")
  return clearance(header ? header.getBoundingClientRect().height : 0)
}

// The nearest ancestor that actually scrolls, so the page also works scaled or embedded.
// The sources panel scrolls on its own and is never the page scroller.
export function scrollerFor(el: Element): HTMLElement | null {
  for (let n = el.parentElement; n && n !== el.ownerDocument.body; n = n.parentElement) {
    if (n.hasAttribute("data-lv2-own-scroll")) continue
    const overflowY = getComputedStyle(n).overflowY
    if ((overflowY === "auto" || overflowY === "scroll") && n.scrollHeight > n.clientHeight + 1) return n
  }
  return null
}

export function viewportOf(el: Element): Edges {
  const scroller = scrollerFor(el)
  if (scroller) {
    const r = scroller.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  }
  return { top: 0, bottom: window.innerHeight }
}

// One scroll by `delta` pixels on whichever element scrolls `el`.
export function scrollByDelta(el: Element, delta: number, behavior: ScrollBehavior): void {
  if (Math.abs(delta) < 1) return
  const scroller = scrollerFor(el)
  if (scroller) scroller.scrollTo({ top: scroller.scrollTop + delta, behavior })
  else window.scrollTo({ top: window.scrollY + delta, behavior })
}

// Scroll so `el`'s top sits at `y` pixels below the top of its viewport.
export function scrollToY(el: Element, y: number, behavior: ScrollBehavior): void {
  const view = viewportOf(el)
  scrollByDelta(el, el.getBoundingClientRect().top - view.top - y, behavior)
}
