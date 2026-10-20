import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

// Real sign-in, sign-up and email confirmation against a LOCAL Supabase in Docker.
//   node e2e/auth/stack.mjs start      (once; then reuse)
//   npx playwright test -c playwright.auth.config.ts
//   node e2e/auth/stack.mjs stop
// The app is built and served with the local project's URL and keys, and a dead API origin:
// research requests are answered by the tests themselves, so nothing paid ever runs.
const stackEnvPath = path.join(__dirname, "test-results", "supabase-e2e", "stack-env.json")
if (!existsSync(stackEnvPath)) {
  throw new Error("Local Supabase isn't running. Start it with: node e2e/auth/stack.mjs start")
}
const stack = JSON.parse(readFileSync(stackEnvPath, "utf8")) as { apiUrl: string; anonKey: string }
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(stack.apiUrl)) throw new Error(`Refusing a non-local Supabase: ${stack.apiUrl}`)

const PORT = 3101
const env = {
  NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:9",
  NEXT_PUBLIC_SENTRY_DSN: "",
  SENTRY_AUTH_TOKEN: "",
  LANDING_PREVIEW: "1",
  NEXT_TELEMETRY_DISABLED: "1",
}

export default defineConfig({
  testDir: "./e2e/auth",
  globalSetup: "./e2e/auth/global-setup.ts",
  outputDir: "test-results/playwright-auth",
  reporter: "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    // localhost, not 127.0.0.1: it's the origin the local project allows for auth redirects.
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // A production build; Next 16 keeps dev output in .next/dev, so a running `next dev` is unaffected.
    command: `npx next build --turbopack && npx next start --port ${PORT} --hostname localhost`,
    url: `http://localhost:${PORT}/terms`,
    reuseExistingServer: false,
    timeout: 300_000,
    env,
  },
})
