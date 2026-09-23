/**
 * Authenticated access to the Python backend.
 *
 * Every backend call must carry the caller's Supabase JWT. The backend derives
 * the user id from that token and scopes all queries by it — a request without
 * one is rejected with 401 rather than served someone else's data.
 *
 * Use these helpers rather than calling axios/fetch directly, so there is one
 * place where the header is attached and one place where 401 is handled.
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

/**
 * Thrown when the backend returned 429.
 *
 * `message` is the backend's own `detail` string, which already names a wait in
 * seconds, so it is safe to show to the user as-is. `retryAfterSeconds` is the
 * parsed Retry-After header, for anything that wants to count down.
 */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number

  constructor(
    message = "You're going a bit fast. Try again shortly.",
    retryAfterSeconds = 30
  ) {
    super(message)
    this.name = "RateLimitedError"
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Retry-After as a usable number of seconds.
 *
 * Clamped, because this value can end up in a setTimeout and a header is not
 * something to trust blindly.
 */
function parseRetryAfter(raw: string | null | undefined): number {
  const seconds = Number.parseInt(raw ?? "", 10)
  if (!Number.isFinite(seconds)) return 30
  return Math.min(Math.max(seconds, 1), 3600)
}

/** Convert a 429 into a RateLimitedError; pass anything else through. */
function asRateLimitError(error: unknown): unknown {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) return error
  const detail = (error.response.data as { detail?: string } | undefined)?.detail
  return new RateLimitedError(
    detail || undefined,
    parseRetryAfter(error.response.headers?.["retry-after"] as string | undefined)
  )
}

/**
 * Current access token, or null when signed out.
 *
 * getSession() refreshes the token if it has expired, so this stays valid
 * across long-lived tabs.
 */
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

/**
 * Send the browser to sign-in after the session has gone away.
 *
 * Deliberately a hard navigation: it drops all in-memory React state, so no
 * previous user's data can linger on screen behind the redirect.
 */
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

// ---------------------------------------------------------------------------
// Authenticated axios wrappers
// ---------------------------------------------------------------------------

/**
 * One place where the token is attached and one place where 429 is translated.
 *
 * Deliberately not an axios interceptor: this module imports bare `axios`, so
 * an interceptor would also fire for every other axios caller in the app.
 */
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
    throw asRateLimitError(error)
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
  if (res.status === 429) {
    // Safe to read the body: this path always throws, so nothing downstream
    // will try to consume the stream again.
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new RateLimitedError(
      body?.detail || undefined,
      parseRetryAfter(res.headers.get("retry-after"))
    )
  }
  return res
}
