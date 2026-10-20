import { vi } from "vitest"

// jsdom has no IntersectionObserver or matchMedia; the landing's playback and reduced-motion
// hooks need both. `setReducedMotion` flips the media query live, like the OS setting.
export function installDomMocks({ reducedMotion = false, inView = true } = {}) {
  const observers: { cb: IntersectionObserverCallback; el?: Element }[] = []
  let reduced = reducedMotion
  const listeners = new Set<(e: MediaQueryListEvent) => void>()

  class MockIntersectionObserver {
    cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb
      observers.push({ cb })
    }
    observe(el: Element) {
      if (inView) {
        this.cb(
          [{ isIntersecting: true, target: el, intersectionRatio: 1 } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        )
      }
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        get matches() {
          return query.includes("prefers-reduced-motion") ? reduced : false
        },
        media: query,
        onchange: null,
        addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  )

  return {
    observers,
    setReducedMotion(value: boolean) {
      reduced = value
      listeners.forEach((cb) => cb({ matches: value } as MediaQueryListEvent))
    },
  }
}
