import { test as base, expect, type Page } from "@playwright/test"

// Every test runs with outside requests aborted. Anything aimed at Supabase fails the test.
export const test = base.extend<{ blocked: string[] }>({
  blocked: [
    async ({ page }, use) => {
      const blocked: string[] = []
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url())
        if (url.hostname === "127.0.0.1" && url.port === "3100") return route.continue()
        blocked.push(url.href)
        return route.abort()
      })
      await use(blocked)
      expect(blocked.filter((u) => /supabase/i.test(u) || u.startsWith("http://127.0.0.1:9/"))).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
  { name: "360", width: 360, height: 780 },
] as const

export async function openLanding(page: Page, path = "/preview/landing") {
  await page.goto(path)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  // Client components hydrated: the nav has measured the header.
  await expect
    .poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".lv2")?.style.getPropertyValue("--header-clear")))
    .not.toBe("")
}

// Ends the hero replay (if it's still running) and waits out the last 0.45s entrance.
export async function finishReplay(page: Page) {
  // The replay starts once the panel is in view (it's below the fold on phones).
  await page.locator("[data-playback-stage]").evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expect(page.locator("[data-playback-stage]")).not.toHaveAttribute("data-playback-stage", "0")
  const skip = page.getByRole("button", { name: "Skip to the end of the replay" })
  if (await skip.isVisible()) await skip.click()
  await expect(page.locator("[data-playback-stage]")).toHaveAttribute("data-playback-stage", "5")
  await page.waitForTimeout(800)
}

export async function headerClear(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector("[data-lv2-header]")!.getBoundingClientRect().height + 16)
}

// Waits until the page and every scroller stop moving (smooth scrolls finish).
export async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = ""
        let still = 0
        const tick = () => {
          const now = [window.scrollY, ...[...document.querySelectorAll("[data-lv2-own-scroll]")].map((e) => e.scrollTop)].join(",")
          still = now === last ? still + 1 : 0
          last = now
          if (still >= 8) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
  )
}

export async function rect(page: Page, selector: string) {
  return page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }
  }, selector)
}
