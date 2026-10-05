/**
 * Authenticated backend calls. Use these instead of axios/fetch directly so the JWT
 * is always attached and 401/429 are handled in one place.
 */

import axios, { AxiosRequestConfig } from "axios"
import { createClient } from "@/lib/supabase/client"

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

/** Thrown when the session is missing or the backend rejected the token. */
export class UnauthenticatedError extends Error {
  constructor(message = "Not signed in") {
    super(message)
    this.name = "UnauthenticatedError"
  }
}

/** A refused request. `message` is the backend's detail and is safe to show as-is. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number
  /** Value of X-Spend-Limit, or null for a regular rate limit. */
  readonly limit: string | null

  constructor(
    message = "You're going a bit fast. Try again shortly.",
    retryAfterSeconds = 30,
    limit: string | null = null
  ) {
    super(message)
    this.name = "RateLimitedError"
    this.retryAfterSeconds = retryAfterSeconds
    this.limit = limit
  }
}

/** Spend-guard 503. Subclassed so existing RateLimitedError handling applies. */
export class CapacityError extends RateLimitedError {
  constructor(message: string, retryAfterSeconds: number, limit: string) {
    super(message, retryAfterSeconds, limit)
    this.name = "CapacityError"
  }
}

/** Moderation refusal. Not retryable; `message` is the backend's detail and is safe to show as-is. */
export class ContentBlockedError extends Error {
  /** "input", "output" or "audio", or "unavailable" when the check itself is down. */
  readonly source: string

  constructor(message: string, source: string) {
    super(message)
    this.name = "ContentBlockedError"
    this.source = source
  }
}

export function limitTitle(error: RateLimitedError, feature = "Research"): string {
  if (error.limit === "user") return "Daily limit reached"
  if (error.limit) return `${feature} unavailable`
  return "Slow down a moment"
}

const SPEND_LIMIT_HEADER = "x-spend-limit"
const CONTENT_BLOCKED_HEADER = "x-content-blocked"

// 400 when flagged, 503 when the check is down and the backend fails closed.
function blockedError(
  status: number | undefined,
  detail: string | undefined,
  blocked: string | null | undefined
): ContentBlockedError | null {
  if (!blocked || (status !== 400 && status !== 503)) return null
  return new ContentBlockedError(
    detail || "This request can't be processed because it may violate our usage policy.",
    blocked
  )
}

// A 503 counts only with X-Spend-Limit; other 503s belong to their callers.
function refusalError(
  status: number | undefined,
  detail: string | undefined,
  retryAfter: string | null | undefined,
  spendLimit: string | null | undefined
): RateLimitedError | null {
  const limit = spendLimit || null
  if (status === 429) {
    return new RateLimitedError(detail || undefined, parseRetryAfter(retryAfter), limit)
  }
  if (status === 503 && limit) {
    return new CapacityError(
      detail || "This feature is temporarily unavailable. Please try again later.",
      parseRetryAfter(retryAfter),
      limit
    )
  }
  return null
}

// Clamped: the value can end up in a setTimeout.
function parseRetryAfter(raw: string | null | undefined): number {
  const seconds = Number.parseInt(raw ?? "", 10)
  if (!Number.isFinite(seconds)) return 30
  return Math.min(Math.max(seconds, 1), 3600)
}

/** Convert a refusal into RateLimitedError or ContentBlockedError; pass anything else through. */
function asRefusalError(error: unknown): unknown {
  if (!axios.isAxiosError(error) || !error.response) return error
  const detail = (error.response.data as { detail?: string } | undefined)?.detail
  return (
    blockedError(
      error.response.status,
      typeof detail === "string" ? detail : undefined,
      error.response.headers?.[CONTENT_BLOCKED_HEADER] as string | undefined
    ) ??
    refusalError(
      error.response.status,
      typeof detail === "string" ? detail : undefined,
      error.response.headers?.["retry-after"] as string | undefined,
      error.response.headers?.[SPEND_LIMIT_HEADER] as string | undefined
    ) ?? error
  )
}

/** Current access token, or null. getSession() refreshes an expired one. */
export async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  if (!token) throw new UnauthenticatedError()
  return { Authorization: `Bearer ${token}` }
}

/** Hard navigation, so no previous user's data stays in memory. */
export function redirectToSignIn(): void {
  if (typeof window === "undefined") return
  const next = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/sign-in?next=${next}`
}

function isAuthFailure(error: unknown): boolean {
  if (error instanceof UnauthenticatedError) return true
  return axios.isAxiosError(error) && error.response?.status === 401
}

/** Run a backend call, redirecting to sign-in if the session is gone. */
export async function withAuthRedirect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isAuthFailure(error)) redirectToSignIn()
    throw error
  }
}

// Not an interceptor: that would apply to every axios caller in the app.
async function request<T>(
  method: "get" | "post" | "patch" | "delete",
  url: string,
  body?: unknown,
  config: AxiosRequestConfig = {}
): Promise<T> {
  const headers = await authHeaders()
  const merged = { ...config, headers: { ...config.headers, ...headers } }

  try {
    const res =
      method === "get"
        ? await axios.get<T>(url, merged)
        : method === "delete"
          ? await axios.delete<T>(url, merged)
          : method === "post"
            ? await axios.post<T>(url, body, merged)
            : await axios.patch<T>(url, body, merged)
    return res.data
  } catch (error) {
    throw asRefusalError(error)
  }
}

export async function authGet<T = unknown>(
  url: string,
  config: AxiosRequestConfig = {}
): Promise<T> {
  return request<T>("get", url, undefined, config)
}

export async function authPost<T = unknown>(
  url: string,
  body?: unknown,
  config: AxiosRequestConfig = {}
): Promise<T> {
  return request<T>("post", url, body, config)
}

export async function authPatch<T = unknown>(
  url: string,
  body?: unknown,
  config: AxiosRequestConfig = {}
): Promise<T> {
  return request<T>("patch", url, body, config)
}

export async function authDelete<T = unknown>(
  url: string,
  config: AxiosRequestConfig = {}
): Promise<T> {
  return request<T>("delete", url, undefined, config)
}

/** Authenticated fetch(), for the streaming endpoint. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders()
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...headers } })
  if (res.status === 401) {
    redirectToSignIn()
    throw new UnauthenticatedError("Session expired")
  }
  const blocked = res.headers.get(CONTENT_BLOCKED_HEADER)
  if (blocked && (res.status === 400 || res.status === 503)) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw blockedError(res.status, body?.detail, blocked)
  }
  if (res.status === 429 || (res.status === 503 && res.headers.get(SPEND_LIMIT_HEADER))) {
    // Safe to read the body: this branch always throws.
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    const refused = refusalError(
      res.status,
      body?.detail,
      res.headers.get("retry-after"),
      res.headers.get(SPEND_LIMIT_HEADER)
    )
    if (refused) throw refused
  }
  return res
}
