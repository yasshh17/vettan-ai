import "@testing-library/jest-dom/vitest"

// Tests must never reach a real Supabase project (the local .env points at production).
// An unmocked client call fails loudly here instead of going out over the network.
const realFetch = globalThis.fetch
if (realFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (/supabase\.(co|in)\b/i.test(url)) {
      return Promise.reject(new Error(`Blocked network call to Supabase in tests: ${url}`))
    }
    return realFetch(input, init)
  }) as typeof fetch
}
