import { expect, finishReplay, openLanding, settle, test } from "./fixtures"

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("final states without the sticky stage, and it switches live", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openLanding(page)
    const stageColumn = page.locator("[data-stage-moment]")
    await expect(stageColumn).toBeHidden()
    await expect(page.getByText("Searches 1–4 from the plan above, running at once")).toBeVisible()
    // Hero shows its final state straight away, no replay.
    await expect(page.locator("[data-playback-stage]")).toHaveAttribute("data-playback-stage", "5")
    await expect(page.getByText("From the report, verbatim")).toBeVisible()
    const running = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect)?.target?.closest?.(".lv2")).length
    )
    expect(running).toBe(0)

    await page.emulateMedia({ reducedMotion: "no-preference" })
    await expect(stageColumn).toBeVisible()
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(stageColumn).toBeHidden()
  })
})

test.describe("signed-out handoff", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("Start research keeps the question for sign-up, and Remove forgets it", async ({ page, blocked }) => {
    await openLanding(page)
    const field = page.locator("#start").getByLabel("Research question")
    const start = page.locator("#start").getByRole("button", { name: "Start research" })
    await expect(start).toBeDisabled()
    await field.fill("Which vector database suits 10k documents?")
    await start.click()
    await expect(page.locator("#start").getByText("Next: sign in or create an account")).toBeVisible()
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("vettan:pendingQuestion") ?? "null"))
    expect(kept?.text).toBe("Which vector database suits 10k documents?")

    await page.locator("#start").getByRole("link", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/sign-up$/)
    await expect(page.getByText("Which vector database suits 10k documents?")).toBeVisible()
    await expect(page.getByText("Kept on this device while you sign up.")).toBeVisible()
    await page.getByRole("button", { name: "Remove" }).click()
    await expect(page.getByText("Which vector database suits 10k documents?")).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem("vettan:pendingQuestion"))).toBeNull()

    // Coming back in the same tab: Remove also forgot the draft, so the field starts empty.
    await page.goto("/preview/landing")
    await expect(page.locator("#start").getByLabel("Research question")).toHaveValue("")
    expect(blocked.filter((u) => /supabase/.test(u))).toEqual([])
  })

  test("returning without signing in finds the question still there", async ({ page }) => {
    await openLanding(page)
    await page.locator("#start").getByLabel("Research question").fill("Kept across sign-in")
    await page.locator("#start").getByRole("button", { name: "Start research" }).click()
    await expect(page.locator("#start").getByText("Next: sign in or create an account")).toBeVisible()
    // New tab session: no per-tab draft, only the kept question.
    await page.evaluate(() => sessionStorage.clear())
    await page.goto("/preview/landing")
    await settle(page)
    await expect(page.locator("#start").getByLabel("Research question")).toHaveValue("Kept across sign-in")
    await expect(page.locator("#start").getByText(/You haven't signed in yet/)).toBeVisible()
  })
})

test.describe("phone menu", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("opens and closes, and its links move to the section", async ({ page }) => {
    await openLanding(page)
    const menu = page.getByRole("button", { name: "Menu" })
    await expect(menu).toHaveAttribute("aria-expanded", "false")
    await menu.click()
    await expect(menu).toHaveAttribute("aria-expanded", "true")
    await page.locator("#lv2-menu").getByRole("link", { name: "Example" }).click()
    await expect(menu).toHaveAttribute("aria-expanded", "false")
    await expect(page).toHaveURL(/#example$/)
  })

  test("Show 2 more sources reveals the last two", async ({ page }) => {
    await openLanding(page)
    await finishReplay(page)
    const sources = page.locator("#start section[aria-label='Sources'] li")
    await expect(sources.nth(3)).toBeHidden()
    await page.getByRole("button", { name: "Show 2 more sources" }).click()
    await expect(sources.nth(3)).toBeVisible()
    await expect(sources.nth(4)).toBeVisible()
  })
})
