import type { BrowserContext, Page } from "@playwright/test"
import {
  appInput,
  askOnLanding,
  confirmationLink,
  createConfirmedUser,
  expect,
  pendingQuestion,
  researchCalls,
  signIn,
  test,
  uniqueEmail,
} from "./helpers"

const PASSWORD = "e2e-Password-123456"

const keptOwner = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("vettan:pendingQuestion") ?? "null") as { owner?: string } | null)?.owner ?? null)

// The session ends without the Sign out button: it expired, or its cookies were cleared.
const endSessionWithoutSigningOut = (context: BrowserContext) => context.clearCookies()

// A second tab gets the same fake backend as the first (the fixture guards only `page`).
async function openTab(context: BrowserContext, calls: string[]) {
  const tab = await context.newPage()
  await tab.route("http://127.0.0.1:9/**", (r) => {
    calls.push(new URL(r.request().url()).pathname)
    return r.request().url().endsWith("/api/history") ? r.fulfill({ json: { sessions: [] } }) : r.fulfill({ json: {} })
  })
  return tab
}
const QUESTION = "Which vector database suits 10k documents?"

test("existing user: question survives sign-in, waits in /app, and runs only when submitted", async ({ page, api }) => {
  const email = uniqueEmail("signin")
  await createConfirmedUser(email, PASSWORD)

  await askOnLanding(page, QUESTION)
  await expect(page.locator("#start").getByText("Next: sign in or create an account")).toBeVisible()
  await page.locator("#start").getByRole("link", { name: "Sign in" }).click()

  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByText(QUESTION)).toBeVisible()
  await expect(page.getByText("Kept on this device while you sign in.")).toBeVisible()
  await signIn(page, email, PASSWORD)

  await expect(page).toHaveURL(/\/app$/)
  await expect(appInput(page)).toHaveValue(QUESTION)
  await expect(page.getByText(/We kept your question from the homepage/)).toBeVisible()
  // Never started on its own, even after waiting.
  await page.waitForTimeout(2500)
  expect(researchCalls(api)).toEqual([])
  expect(await pendingQuestion(page)).toBe(QUESTION)

  await page.getByLabel("Submit research query").click()
  await expect.poll(() => researchCalls(api).length).toBe(1)
  expect(JSON.parse(researchCalls(api)[0].body!)).toMatchObject({ query: QUESTION })
  // Answered, so the kept copy has done its job.
  await expect.poll(() => pendingQuestion(page)).toBeNull()
})

test("new user: sign-up, email confirmation link, then the question is waiting in /app", async ({ page, api }) => {
  const email = uniqueEmail("signup")

  // Also covers the gated preview route, which renders the same landing page.
  await askOnLanding(page, QUESTION, "/preview/landing")
  await page.locator("#start").getByRole("link", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.getByText("Kept on this device while you sign up.")).toBeVisible()

  await page.getByLabel("Full name").fill("E2E Signup")
  await page.getByLabel("Date of birth").fill("1995-04-12")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible()
  await expect(page.getByText(QUESTION)).toBeVisible()
  await expect(page.getByText("Open the link on this device and your question will be waiting.")).toBeVisible()

  // The real email from the local mail catcher, opened in the same browser.
  const link = await confirmationLink(email)
  // Issued by the local project, pointing back at this app's callback.
  expect(new URL(link).hostname).toBe("127.0.0.1")
  expect(new URL(link).searchParams.get("redirect_to")).toContain("localhost:3101/auth/callback")
  await page.goto(link)

  await expect(page).toHaveURL(/\/app$/)
  await expect(appInput(page)).toHaveValue(QUESTION)
  // Claimed by the new account, so no later account on this browser can see it.
  await expect.poll(() => keptOwner(page)).not.toBeNull()
  await page.waitForTimeout(2500)
  expect(researchCalls(api)).toEqual([])
})

test("signed in: the landing page opens /app with the question, and auth pages send you to /app", async ({ page, api }) => {
  const email = uniqueEmail("nav")
  await createConfirmedUser(email, PASSWORD)
  await page.goto("/sign-in")
  await signIn(page, email, PASSWORD)
  await expect(page).toHaveURL(/\/app$/)

  await page.goto("/")
  await expect(page.locator("#start").getByText("Your question will open in Vettan.")).toBeVisible()
  await page.locator("#start").getByLabel("Research question").fill(QUESTION)
  await page.locator("#start").getByRole("button", { name: "Start research" }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(appInput(page)).toHaveValue(QUESTION)
  await page.waitForTimeout(2000)
  expect(researchCalls(api)).toEqual([])

  // Already signed in: the sign-in page redirects to /app, where the question still waits.
  await page.goto("/sign-in")
  await expect(page).toHaveURL(/\/app$/)
  await expect(appInput(page)).toHaveValue(QUESTION)
  expect(researchCalls(api)).toEqual([])
})

test("leaving /app before submitting doesn't lose the question", async ({ page, api }) => {
  const email = uniqueEmail("leave")
  await createConfirmedUser(email, PASSWORD)
  await askOnLanding(page, QUESTION)
  await page.locator("#start").getByRole("link", { name: "Sign in" }).click()
  await signIn(page, email, PASSWORD)
  await expect(appInput(page)).toHaveValue(QUESTION)

  // Clear the box and start a new chat: it's offered again.
  await appInput(page).fill("")
  await page.getByRole("button", { name: "New chat" }).click()
  await expect(appInput(page)).toHaveValue(QUESTION)

  // Go somewhere else and come back, then reload.
  await page.goto("/")
  await page.goto("/app")
  await expect(appInput(page)).toHaveValue(QUESTION)
  await page.reload()
  await expect(appInput(page)).toHaveValue(QUESTION)
  expect(await pendingQuestion(page)).toBe(QUESTION)
  expect(researchCalls(api)).toEqual([])

  // An explicit choice to drop it is respected.
  await page.getByRole("button", { name: "Forget it" }).click()
  expect(await pendingQuestion(page)).toBeNull()
  await page.reload()
  await expect(appInput(page)).toHaveValue("")
})

test("signing out removes the question from the device", async ({ page, api }) => {
  const email = uniqueEmail("signout")
  await createConfirmedUser(email, PASSWORD)
  await askOnLanding(page, QUESTION)
  await page.locator("#start").getByRole("link", { name: "Sign in" }).click()
  await signIn(page, email, PASSWORD)
  await expect(appInput(page)).toHaveValue(QUESTION)

  await page.getByRole("button").filter({ hasText: email }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
  expect(await pendingQuestion(page)).toBeNull()
  expect(await page.evaluate(() => sessionStorage.getItem("vettan:draftQuestion"))).toBeNull()
  expect(researchCalls(api)).toEqual([])
})

test("a password reset signs out everywhere and removes the question from the device", async ({ page, api }) => {
  const email = uniqueEmail("reset")
  await createConfirmedUser(email, PASSWORD)
  await askOnLanding(page, QUESTION)
  expect(await pendingQuestion(page)).toBe(QUESTION)

  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByText(/We sent a password reset link/)).toBeVisible()

  await page.goto(await confirmationLink(email))
  await expect(page).toHaveURL(/\/reset-password$/)
  await page.getByLabel("New password", { exact: true }).fill("e2e-New-Password-987654")
  await page.getByLabel("Confirm new password").fill("e2e-New-Password-987654")
  await page.getByRole("button", { name: "Update password" }).click()
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible()

  expect(await pendingQuestion(page)).toBeNull()
  expect(await page.evaluate(() => sessionStorage.getItem("vettan:draftQuestion"))).toBeNull()
  expect(researchCalls(api)).toEqual([])
})

test("an auth link that lands on the homepage is still handed to the callback", async ({ page }) => {
  // Supabase sends links to the Site URL root when a redirect isn't allowed; the proxy forwards them.
  await page.goto("/?code=not-a-real-code")
  await expect(page).toHaveURL(/\/sign-in\?error=link_invalid$/)
  await page.goto("/?error_code=otp_expired")
  await expect(page).toHaveURL(/\/sign-in\?error=link_invalid$/)
})


test.describe("privacy on a shared browser", () => {
  test("after A's session ends without signing out, B never sees A's question", async ({ page, context, api }) => {
    const a = uniqueEmail("priv-a")
    const b = uniqueEmail("priv-b")
    await createConfirmedUser(a, PASSWORD)
    await createConfirmedUser(b, PASSWORD)
    await askOnLanding(page, "A's private question")
    await page.locator("#start").getByRole("link", { name: "Sign in" }).click()
    await signIn(page, a, PASSWORD)
    await expect(appInput(page)).toHaveValue("A's private question")
    await expect.poll(() => keptOwner(page)).not.toBeNull()

    await endSessionWithoutSigningOut(context)
    // Signed out on the landing page: not shown.
    await page.goto("/")
    await page.waitForTimeout(1500)
    await expect(page.locator("#start").getByLabel("Research question")).toHaveValue("")
    // On the sign-in page: not shown.
    await page.goto("/sign-in")
    await expect(page.getByText("A's private question")).toHaveCount(0)
    await expect(page.getByText("Your question")).toHaveCount(0)
    // B signs in: /app doesn't offer it, and it's gone from the device.
    await signIn(page, b, PASSWORD)
    await expect(page).toHaveURL(/\/app$/)
    await page.waitForTimeout(1500)
    await expect(appInput(page)).toHaveValue("")
    await expect(page.getByText(/We kept your question|A's private question/)).toHaveCount(0)
    expect(await pendingQuestion(page)).toBeNull()
    // And not on the landing page as B either.
    await page.goto("/")
    await page.waitForTimeout(1500)
    await expect(page.locator("#start").getByLabel("Research question")).toHaveValue("")
    expect(researchCalls(api)).toEqual([])
  })

  test("A gets their own question back after their session expires", async ({ page, context, api }) => {
    const a = uniqueEmail("priv-back")
    await createConfirmedUser(a, PASSWORD)
    await askOnLanding(page, "Mine after expiry")
    await page.locator("#start").getByRole("link", { name: "Sign in" }).click()
    await signIn(page, a, PASSWORD)
    await expect(appInput(page)).toHaveValue("Mine after expiry")
    await endSessionWithoutSigningOut(context)
    await page.goto("/sign-in")
    await signIn(page, a, PASSWORD)
    await expect(page).toHaveURL(/\/app$/)
    await expect(appInput(page)).toHaveValue("Mine after expiry")
    expect(researchCalls(api)).toEqual([])
  })

  test("two tabs: the owner sees it in both; after an account switch, neither tab shows it", async ({ page, context, api }) => {
    const a = uniqueEmail("tabs-a")
    const b = uniqueEmail("tabs-b")
    await createConfirmedUser(a, PASSWORD)
    await createConfirmedUser(b, PASSWORD)
    const tabCalls: string[] = []

    // Tab 1: typed while signed out.
    await askOnLanding(page, "Question across tabs")
    // Tab 2: signs in, and /app claims it for A.
    const tab2 = await openTab(context, tabCalls)
    await tab2.goto("/sign-in")
    await expect(tab2.getByText("Question across tabs")).toBeVisible()
    await signIn(tab2, a, PASSWORD)
    await expect(appInput(tab2)).toHaveValue("Question across tabs")
    await expect.poll(() => keptOwner(tab2)).not.toBeNull()
    // Tab 1, now signed in as A, still shows A's question.
    await page.reload()
    await expect(page.locator("#start").getByLabel("Research question")).toHaveValue("Question across tabs")

    // A's session ends without signing out; B signs in from tab 2.
    await endSessionWithoutSigningOut(context)
    await tab2.goto("/sign-in")
    await expect(tab2.getByText("Question across tabs")).toHaveCount(0)
    await signIn(tab2, b, PASSWORD)
    await expect(tab2).toHaveURL(/\/app$/)
    await tab2.waitForTimeout(1500)
    await expect(appInput(tab2)).toHaveValue("")
    // Tab 1's landing page, now B's session, doesn't show it either.
    await page.reload()
    await page.waitForTimeout(1500)
    await expect(page.locator("#start").getByLabel("Research question")).toHaveValue("")
    expect(researchCalls(api)).toEqual([])
    expect(tabCalls.filter((p) => p.startsWith("/api/research"))).toEqual([])
  })
})
