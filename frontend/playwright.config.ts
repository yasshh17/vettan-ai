import { defineConfig, devices } from "@playwright/test"

// Browser checks for the landing preview. Local only for now, not part of CI.
// Real-auth tests live in e2e/auth with playwright.auth.config.ts.
//
// Isolation: the test server gets dead Supabase and API origins. Variables set here win over
// .env.local, so neither the browser nor the server-side proxy can reach a real project.
// Tests also abort every request that isn't to this server (see e2e/fixtures.ts).
const PORT = 3100
export const E2E_ORIGIN = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  // Real-auth tests need the local Supabase; they have their own config.
  testIgnore: ["auth/**"],
  globalSetup: "./e2e/global-setup.ts",
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results/playwright",
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },
  webServer: {
    // A production build: it can run next to a developer's `next dev` (Next 16 keeps dev output
    // in .next/dev) and it tests what ships.
    command: `npx next build --turbopack && npx next start --port ${PORT} --hostname 127.0.0.1`,
    url: `${E2E_ORIGIN}/terms`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-dummy-anon-key",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SENTRY_DSN: "",
      SENTRY_AUTH_TOKEN: "",
      LANDING_PREVIEW: "1",
      // A developer's local v3 switch must not change what / shows under test.
      LANDING_V3_HOME: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
})
