import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/nextjs"

export type StreamedSpan = Parameters<NonNullable<BrowserOptions["beforeSendSpan"]>>[0]

// Off unless a DSN is set. Questions, answers, tokens and IPs must never be
// sent: dataCollection stops the SDK gathering them and the scrubbers below
// catch anything that still gets through.

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ""

// Referer can carry the last page's query string.
const DROP_HEADERS = new Set(["authorization", "cookie", "referer", "x-forwarded-for", "x-real-ip"])

// Span attributes that hold a URL.
const URL_ATTRIBUTE = /url|referer|referrer|http\.target/i
const DROP_ATTRIBUTES = new Set(["url.query", "url.fragment", "http.query", "http.fragment"])

export function stripQuery(url: unknown): unknown {
  if (typeof url !== "string") return url
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

function stripQueryFromName(name: string): string {
  const [method, ...rest] = name.split(" ")
  return rest.length ? `${method} ${stripQuery(rest.join(" "))}` : (stripQuery(name) as string)
}

function scrubData(data: Record<string, unknown> | undefined) {
  if (!data) return
  for (const key of ["url", "from", "to"]) {
    if (key in data) data[key] = stripQuery(data[key])
  }
  delete data["http.query"]
  delete data["http.fragment"]
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Console output can quote what the user typed.
  if (crumb.category === "console" || crumb.type === "log") return null
  scrubData(crumb.data)
  return crumb
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request
  if (request) {
    delete request.data
    delete request.cookies
    delete request.query_string
    delete request.env
    request.url = stripQuery(request.url) as string | undefined
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([k]) => !DROP_HEADERS.has(k.toLowerCase()))
      )
    }
  }

  // Messages can echo input (JSON parse errors quote the bad text).
  for (const exc of event.exception?.values ?? []) {
    if (exc.value) exc.value = ""
  }

  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {}
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((c: Breadcrumb | null): c is Breadcrumb => c !== null)
  }

  return event
}

// Spans are streamed in v11, so beforeSendTransaction never sees them.
export function scrubSpan(span: StreamedSpan): StreamedSpan {
  span.name = stripQueryFromName(span.name)
  const attributes = span.attributes as Record<string, unknown>
  for (const key of Object.keys(attributes)) {
    if (DROP_ATTRIBUTES.has(key)) {
      delete attributes[key]
      continue
    }
    if (!URL_ATTRIBUTE.test(key)) continue
    const raw = attributes[key]
    if (typeof raw === "string") {
      attributes[key] = stripQuery(raw)
    } else if (raw && typeof raw === "object" && "value" in raw) {
      const wrapped = raw as { value: unknown }
      wrapped.value = stripQuery(wrapped.value)
    }
  }
  return span
}

function sampleRate(): number {
  const raw = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.1
}

// Shared by the browser, Node and edge. `satisfies` turns an option the SDK
// dropped into a type error instead of silently ignoring it.
// No Session Replay: it would record questions and answers on screen.
export const sentryOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_DSN !== "",
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_VERCEL_ENV || "production",
  // Everything is on by default in v11.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ["user-agent"] }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  tracesSampleRate: sampleRate(),
  beforeSend: (event: ErrorEvent) => scrubEvent(event),
  beforeSendSpan: (span: StreamedSpan) => scrubSpan(span),
  beforeBreadcrumb: (crumb: Breadcrumb) => scrubBreadcrumb(crumb),
} satisfies BrowserOptions
