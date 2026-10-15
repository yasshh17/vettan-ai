// Marker text must never reach Sentry.
import type { ErrorEvent } from "@sentry/nextjs"
import { describe, expect, it } from "vitest"
import { config as proxyConfig } from "@/proxy"
import { scrubBreadcrumb, scrubEvent, scrubSpan, sentryOptions, stripQuery, type StreamedSpan } from "@/lib/sentry"

const MARKER = "MARKER-7f3a"
const IP = "203.0.113.9"

describe("Sentry scrubbing", () => {
  it("strips content, tokens and IPs from error events", () => {
    const event = {
      type: undefined,
      request: {
        url: `https://vettan.example/app?q=${MARKER}`,
        query_string: `q=${MARKER}`,
        data: { query: MARKER },
        cookies: { sb: MARKER },
        headers: {
          Authorization: `Bearer ${MARKER}`,
          Cookie: MARKER,
          Referer: `https://vettan.example/app?q=${MARKER}`,
          "X-Forwarded-For": IP,
          "User-Agent": "test-agent",
        },
      },
      exception: { values: [{ type: "SyntaxError", value: `Unexpected token, "${MARKER}" is not valid JSON` }] },
      user: { id: "abc", ip_address: IP, email: "a@example.com" },
      breadcrumbs: [
        { category: "console", message: `typed: ${MARKER}` },
        { category: "fetch", data: { url: `https://api.example/api/history?q=${MARKER}`, method: "GET" } },
        { category: "navigation", data: { from: `/app?q=${MARKER}`, to: "/app" } },
      ],
    } as unknown as ErrorEvent

    const dump = JSON.stringify(scrubEvent(event))
    expect(dump).not.toContain(MARKER)
    expect(dump).not.toContain(IP)
    expect(dump).not.toContain("a@example.com")
    expect(event.request?.url).toBe("https://vettan.example/app")
    expect(event.request?.headers).toEqual({ "User-Agent": "test-agent" })
    expect(event.exception?.values?.[0].type).toBe("SyntaxError")
    expect(event.user).toEqual({ id: "abc" })
    expect(event.breadcrumbs?.map((c) => c.category)).toEqual(["fetch", "navigation"])
  })

  it("strips query strings from streamed spans", () => {
    const span = {
      name: `GET https://api.example/api/history?q=${MARKER}`,
      attributes: {
        "url.full": { value: `http://localhost/privacy?q=${MARKER}`, type: "string" },
        "http.url": `https://api.example/x?q=${MARKER}`,
        "url.query": `q=${MARKER}`,
        "sentry.op": "http.client",
      },
    } as unknown as StreamedSpan
    scrubSpan(span)
    expect(span.name).toBe("GET https://api.example/api/history")
    expect(JSON.stringify(span)).not.toContain(MARKER)
    expect((span.attributes as Record<string, unknown>)["sentry.op"]).toBe("http.client")
  })

  it("drops console breadcrumbs and strips query strings", () => {
    expect(scrubBreadcrumb({ category: "console", message: MARKER })).toBeNull()
    expect(stripQuery(`/a?b=${MARKER}#c`)).toBe("/a")
    expect(stripQuery("/a")).toBe("/a")
  })

  it("stays off without a DSN and collects nothing about the person", () => {
    expect(sentryOptions.enabled).toBe(false)
    const dc = sentryOptions.dataCollection
    expect(dc.userInfo).toBe(false)
    expect(dc.cookies).toBe(false)
    expect(dc.httpBodies).toEqual([])
    expect(dc.urlQueryParams).toBe(false)
    expect(dc.stackFrameVariables).toBe(false)
    expect(dc.genAI).toEqual({ inputs: false, outputs: false })
  })
})

describe("Sentry tunnel", () => {
  // Signed-out visitors' error reports would otherwise be redirected to sign-in.
  it("is excluded from the auth proxy matcher", () => {
    const pattern = new RegExp(`^${proxyConfig.matcher[0]}$`)
    expect(pattern.test("/monitoring")).toBe(false)
    expect(pattern.test("/app")).toBe(true)
  })
})
