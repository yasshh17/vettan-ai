import { vi } from "vitest"

// Refuses every real request and records the attempt, so a test can assert none happened.
// Both transports: authFetch (the stream) uses fetch, while authPost/authGet use axios, which
// sends through XMLHttpRequest in jsdom. A guard on fetch alone would miss the fallback POST.
// Call it in beforeEach; vi.unstubAllGlobals() in afterEach puts the real ones back.
export function blockNetwork(): string[] {
  const attempts: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      attempts.push(`fetch ${String(input)}`)
      return Promise.reject(new TypeError("Network blocked in tests"))
    })
  )
  class BlockedXMLHttpRequest {
    open(method: string, url: string) {
      attempts.push(`xhr ${method} ${url}`)
    }
    send() {
      throw new Error("Network blocked in tests")
    }
    setRequestHeader() {}
    abort() {}
    addEventListener() {}
    removeEventListener() {}
  }
  vi.stubGlobal("XMLHttpRequest", BlockedXMLHttpRequest)
  return attempts
}
