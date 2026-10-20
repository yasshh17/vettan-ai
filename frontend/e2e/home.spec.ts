import type { Page } from "@playwright/test"
import { expect, openLanding, settle, test } from "./fixtures"

// The homepage at / is Landing v62: the same component as /preview/landing, ungated.

async function outline(page: Page) {
  return page.evaluate(() => ({
    sections: [...document.querySelectorAll("main section[id], main section[aria-labelledby]")].map(
      (s) => s.id || s.getAttribute("aria-labelledby")
    ),
    headings: [...document.querySelectorAll("h1, h2")].map((h) => h.textContent?.trim()),
  }))
}

test.describe("homepage at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("renders Landing v62, the same page as the preview, without the old homepage", async ({ page }) => {
    await openLanding(page, "/")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Think deeper.Discover faster.")
    for (const name of ["How Vettan works", "Inspect a real report", "What else you can do", "Stop reading ten tabs."]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible()
    }
    const body = await page.locator("body").innerText()
    expect(body).not.toMatch(/Vettan reasons before it answers|See the architecture|ReAct|multi-agent/i)

    await expect(page).toHaveTitle("Vettan · Think deeper. Discover faster.")
    expect(await page.locator('meta[name="robots"]').count()).toBe(0)

    const home = await outline(page)
    await openLanding(page, "/preview/landing")
    expect(await outline(page)).toEqual(home)
  })

  test("nav links move to their sections, and Sign in goes to sign-in", async ({ page }) => {
    await openLanding(page, "/")
    const nav = page.getByRole("navigation", { name: "Main" })
    await nav.getByRole("link", { name: "How it works" }).click()
    await expect(page).toHaveURL(/\/#how$/)
    await settle(page)
    expect(await page.locator("#how").evaluate((el) => Math.abs(el.getBoundingClientRect().top) < 120)).toBe(true)
    await nav.getByRole("link", { name: "Example" }).click()
    await expect(page).toHaveURL(/\/#example$/)
    await nav.getByRole("link", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/sign-in$/)
  })

  test("hero and closing fields keep the question and send visitors to sign in", async ({ page }) => {
    for (const where of ["#start", "section[aria-labelledby='cta-title']"]) {
      await openLanding(page, "/")
      await page.evaluate(() => localStorage.clear())
      const scope = page.locator(where)
      await scope.getByLabel("Research question").fill(`Question from ${where}`)
      await scope.getByRole("button", { name: "Start research" }).click()
      await expect(scope.getByText("Next: sign in or create an account")).toBeVisible()
      await expect(scope.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/sign-up")
      await expect(scope.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in")
      const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("vettan:pendingQuestion") ?? "null"))
      expect(kept?.text).toBe(`Question from ${where}`)
    }
  })

  test("Stage 06 IBM citation still selects without moving anything", async ({ page }) => {
    await openLanding(page, "/")
    await page.locator("#how").scrollIntoViewIfNeeded()
    await page.getByRole("button", { name: "6. Result" }).click()
    const stage = page.locator("[data-stage-moment]")
    await expect(stage).toHaveAttribute("data-stage-moment", "5")
    await settle(page)
    await page.waitForTimeout(1300)
    const ibm = stage.getByRole("button", { name: "Citation: www.ibm.com. Show this source" })
    const before = await ibm.evaluate((el) => JSON.stringify(el.closest("p")!.getBoundingClientRect()))
    await ibm.click()
    await expect(ibm).toHaveAttribute("aria-pressed", "true")
    await expect(ibm.locator("[data-citation-check]")).toBeVisible()
    expect(await ibm.evaluate((el) => JSON.stringify(el.closest("p")!.getBoundingClientRect()))).toBe(before)
  })
})

test.describe("homepage on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("menu works and nothing scrolls sideways", async ({ page }) => {
    await openLanding(page, "/")
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    const menu = page.getByRole("button", { name: "Menu" })
    await menu.click()
    await expect(menu).toHaveAttribute("aria-expanded", "true")
    await page.locator("#lv2-menu").getByRole("link", { name: "How it works" }).click()
    await expect(menu).toHaveAttribute("aria-expanded", "false")
    await expect(page).toHaveURL(/\/#how$/)
    await menu.click()
    await expect(page.locator("#lv2-menu").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in")
  })
})
