import { readFileSync } from "node:fs"
import path from "node:path"
import { test as base, expect, type Page } from "@playwright/test"

const stack = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "test-results", "supabase-e2e", "stack-env.json"), "utf8")
) as { apiUrl: string; anonKey: string; serviceRoleKey: string; mailUrl: string }

const APP = "http://localhost:3101"
const API = "http://127.0.0.1:9"

export interface ApiCall {
  method: string
  path: string
  body: string | null
}

// Each test gets: a log of backend calls (answered here, never by a real backend), and a
// guard that aborts anything that isn't the app, the local Supabase or the fake backend.
export const test = base.extend<{ api: ApiCall[] }>({
  api: [
    async ({ page }, use) => {
      const calls: ApiCall[] = []
      const strays: string[] = []
      await page.route("**/*", async (route) => {
        const req = route.request()
        const url = new URL(req.url())
        if (url.origin === APP || url.origin === stack.apiUrl) return route.continue()
        if (url.origin === API) {
          calls.push({ method: req.method(), path: url.pathname, body: req.postData() })
          if (url.pathname === "/api/research/stream") {
            const done = { session_id: "e2e-session", citations: [], metadata: {} }
            return route.fulfill({
              status: 200,
              headers: { "content-type": "text/event-stream" },
              body: `event: done\ndata: ${JSON.stringify(done)}\n\n`,
            })
          }
          if (url.pathname === "/api/history") return route.fulfill({ json: { sessions: [] } })
          return route.fulfill({ json: {} })
        }
        strays.push(url.href)
        return route.abort()
      })
      await use(calls)
      expect(strays.filter((u) => /supabase\.(co|in)/.test(u))).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const researchCalls = (calls: ApiCall[]) => calls.filter((c) => c.path.startsWith("/api/research"))

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`
}

const admin = (p: string, init: RequestInit = {}) =>
  fetch(`${stack.apiUrl}/auth/v1/admin${p}`, {
    ...init,
    headers: {
      apikey: stack.serviceRoleKey,
      authorization: `Bearer ${stack.serviceRoleKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })

// An existing, confirmed account, created through the local Supabase admin API.
export async function createConfirmedUser(email: string, password: string) {
  const res = await admin("/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "E2E User" } }),
  })
  if (!res.ok) throw new Error(`could not create user: ${res.status} ${await res.text()}`)
}

// The newest auth link (confirmation or password reset) from the local mail catcher, as the
// visitor would click it. `after` skips emails that were already there.
export async function confirmationLink(email: string, after = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const search = await fetch(`${stack.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    const { messages } = (await search.json()) as { messages: { ID: string }[] }
    if (messages?.length > after) {
      const msg = (await (await fetch(`${stack.mailUrl}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string; Text: string }
      const link = (msg.HTML || msg.Text).match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]
      if (!link) throw new Error("confirmation email has no verify link")
      return link.replace(/&amp;/g, "&")
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no confirmation email for ${email}`)
}

export const pendingQuestion = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("vettan:pendingQuestion")
    return raw ? (JSON.parse(raw) as { text: string }).text : null
  })

// The homepage is the landing page; the gated /preview/landing renders the same component.
export async function askOnLanding(page: Page, question: string, path = "/") {
  await page.goto(path)
  const field = page.locator("#start").getByLabel("Research question")
  await field.fill(question)
  await page.locator("#start").getByRole("button", { name: "Start research" }).click()
}

export async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
}

export const appInput = (page: Page) => page.getByLabel("Enter your research question")
