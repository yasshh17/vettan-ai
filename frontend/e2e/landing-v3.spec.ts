import type { Locator, Page } from "@playwright/test"
import { VIEWPORTS, expect, openLanding, test } from "./fixtures"

// Landing v3 ("Research Observatory") while it's built behind /preview/observatory.
const PATH = "/preview/observatory"
const SHOTS = process.env.PW_OUTPUT_DIR ?? "test-results/playwright"

for (const vp of VIEWPORTS) {
  test.describe(`landing v3 at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test("hero renders, the constellation starts, and nothing runs off the screen", async ({ page }) => {
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(String(e)))
      await openLanding(page, PATH)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Research you can check.")
      await expect(page.locator("#start").getByRole("button", { name: "Start research" })).toBeDisabled()
      // The canvas fades in once the engine has drawn its first frame.
      await expect(page.locator("#start canvas")).toHaveCSS("opacity", "1", { timeout: 10_000 })
      // Let the replay reach its last moment.
      await expect(page.locator("#start").getByText("06 Result")).toHaveAttribute("aria-current", "step", { timeout: 15_000 })
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
      expect(errors).toEqual([])
      await page.screenshot({ path: `${SHOTS}/landing-v3-hero-${vp.name}.png` })
    })
  })
}

test.describe("landing v3 interactions", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("Ask a question puts the cursor in the hero's field", async ({ page }) => {
    await openLanding(page, PATH)
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ask a question" }).click()
    await expect(page.locator("#start").getByLabel("Research question")).toBeFocused()
  })

  test("steps are read out only for a replay someone asked for", async ({ page }) => {
    await openLanding(page, PATH)
    const live = page.locator("#start [data-replay-status]")
    await expect(page.locator("#start").getByText("06 Result")).toHaveAttribute("aria-current", "step", { timeout: 15_000 })
    await expect(live).toHaveText("")
    await page.getByRole("button", { name: "Replay" }).click()
    await expect(live).toContainText(/Step \d of 6/)
  })

  test("pointing at the citation lights its source", async ({ page }) => {
    await openLanding(page, PATH)
    await expect(page.locator("#start").getByText("06 Result")).toHaveAttribute("aria-current", "step", { timeout: 15_000 })
    await page.locator("#start").getByRole("button", { name: "Citation: montecarlo.ai. Show this source" }).hover()
    await expect(page.locator("#start span.text-white", { hasText: "montecarlo.ai" })).toBeVisible()
  })

  // v62's late-revealing replay put LCP at about 3.4s. Here the largest paint is hero text,
  // never the animation, and it lands well inside the 2.5s budget.
  test("the largest paint is hero text, fast, never the animation", async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __lcp: [number, string, boolean] | null }).__lcp = null
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { element?: Element })[]) {
          ;(window as unknown as { __lcp: [number, string, boolean] }).__lcp = [
            e.startTime,
            e.element?.tagName ?? "",
            Boolean(e.element?.closest("#start")),
          ]
        }
      }).observe({ type: "largest-contentful-paint", buffered: true })
    })
    await openLanding(page, PATH)
    await page.waitForTimeout(1500)
    const [ms, tag, inHero] = (await page.evaluate(() => (window as unknown as { __lcp: [number, string, boolean] }).__lcp))!
    expect(inHero).toBe(true)
    expect(["CANVAS", "IMG"]).not.toContain(tag)
    expect(ms).toBeLessThan(2500)
  })

  test("under reduced motion the finished run shows at once, with no replay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openLanding(page, PATH)
    await expect(page.locator("#start").getByText("06 Result")).toHaveAttribute("aria-current", "step")
    await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0)
    await expect(page.locator("#start canvas")).toHaveCSS("opacity", "1", { timeout: 10_000 })
    await page.screenshot({ path: `${SHOTS}/landing-v3-hero-reduced.png` })
  })
})

test.describe("landing v3 phone menu", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("opens as a dialog, closes on Escape and gives focus back", async ({ page }) => {
    await openLanding(page, PATH)
    const trigger = page.getByRole("button", { name: "Menu" })
    await trigger.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/landing-v3-menu-390.png` })
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test("Ask a question from the menu lands in the field", async ({ page }) => {
    await openLanding(page, PATH)
    await page.getByRole("button", { name: "Menu" }).click()
    await page.getByRole("dialog").getByRole("link", { name: "Ask a question" }).click()
    await expect(page.locator("#start").getByLabel("Research question")).toBeFocused()
  })
})

// The stage's shape comes from CSS, so nothing below it jumps once the script measures.
for (const vp of [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
]) {
  test.describe(`landing v3 layout shift at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test("the hero barely shifts while it loads", async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number }
        w.__cls = 0
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!e.hadRecentInput) w.__cls += e.value
          }
        }).observe({ type: "layout-shift", buffered: true })
      })
      await openLanding(page, PATH)
      await expect(page.locator("#start canvas")).toHaveCSS("opacity", "1", { timeout: 10_000 })
      await page.waitForTimeout(1000)
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls)
      expect(cls).toBeLessThan(0.05)
    })
  })
}

// The whole page, section by section.
for (const vp of VIEWPORTS) {
  test.describe(`landing v3 full page at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test("every section renders and nothing runs off the screen", async ({ page }) => {
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(String(e)))
      await openLanding(page, PATH)
      for (const id of ["how", "example", "features"]) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded()
        await expect(page.locator(`#${id} h2`)).toBeVisible()
      }
      await page.getByRole("contentinfo").scrollIntoViewIfNeeded()
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
      expect(errors).toEqual([])
      await page.screenshot({ path: `${SHOTS}/landing-v3-full-${vp.name}.png`, fullPage: true })
    })
  })
}

test.describe("landing v3 sections", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("the nav jumps to each section", async ({ page }) => {
    await openLanding(page, PATH)
    const nav = page.getByRole("navigation", { name: "Main" })
    for (const [name, id] of [["How it works", "how"], ["Example report", "example"], ["Features", "features"]] as const) {
      await nav.getByRole("link", { name }).click()
      await expect(page.locator(`#${id} h2`)).toBeInViewport()
    }
  })

  test("scrolling the story moves the rail to the result", async ({ page }) => {
    await openLanding(page, PATH)
    const rail = page.locator("#how").getByRole("navigation", { name: "Story moments" }).last()
    await page.locator("#moment-6").scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 200)
    await expect(rail.getByRole("button", { name: "6. Result" })).toHaveAttribute("aria-current", "step")
    await rail.getByRole("button", { name: "2. Plan" }).click()
    await expect(rail.getByRole("button", { name: "2. Plan" })).toHaveAttribute("aria-current", "step")
  })

  test("pointing at a report citation marks its source card", async ({ page }) => {
    await openLanding(page, PATH)
    const cite = page.locator("#example").getByRole("button", { name: /^Citation: / }).first()
    await cite.scrollIntoViewIfNeeded()
    const rank = await cite.getAttribute("data-source-rank")
    await cite.click()
    await expect(page.locator(`#source-${rank}`)).toContainText("Selected")
  })
})

test.describe("landing v3 phone report", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("a citation opens the source sheet; Escape closes it and focus returns", async ({ page }) => {
    await openLanding(page, PATH)
    const cite = page.locator("#example").getByRole("button", { name: /^Citation: / }).first()
    await cite.scrollIntoViewIfNeeded()
    await cite.click()
    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("link", { name: /Open page/ })).toBeFocused()
    await page.screenshot({ path: `${SHOTS}/landing-v3-sheet-390.png` })
    // Non-modal: the report still scrolls underneath.
    const before = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 300)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)
    await expect(cite).toBeFocused()
  })
})

test.describe("landing v3 phone report, touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  // Room between a citation and the top of the open source sheet.
  const room = (cite: Locator) => cite.evaluate((el) => document.querySelector("[role=dialog]")!.getBoundingClientRect().top - el.getBoundingClientRect().bottom)
  const cites = (page: Page) => page.locator("#example").getByRole("button", { name: /^Citation: / })

  test("a citation tapped low on the screen ends up above the sheet", async ({ page }) => {
    await openLanding(page, PATH)
    const cite = cites(page).nth(3)
    await cite.evaluate((el) => scrollTo({ top: scrollY + el.getBoundingClientRect().top - innerHeight + 90, behavior: "instant" }))
    await cite.tap()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect.poll(() => room(cite)).toBeGreaterThanOrEqual(24)
  })

  test("switching to a citation hidden behind the open sheet brings it into view", async ({ page }) => {
    await openLanding(page, PATH)
    const first = cites(page).first()
    await first.scrollIntoViewIfNeeded()
    await first.tap()
    await expect(page.getByRole("dialog")).toBeVisible()
    // A later citation of another source, parked behind the sheet, then chosen from the keyboard.
    const firstRank = await first.getAttribute("data-source-rank")
    const index = await cites(page).evaluateAll((els, rank) => els.findIndex((el, i) => i > 2 && el.getAttribute("data-source-rank") !== rank), firstRank)
    const target = cites(page).nth(index)
    await target.evaluate((el) => {
      const top = document.querySelector("[role=dialog]")!.getBoundingClientRect().top
      scrollTo({ top: scrollY + el.getBoundingClientRect().top - top - 30, behavior: "instant" })
      el.focus({ preventScroll: true })
    })
    expect(await room(target)).toBeLessThan(0)
    await page.keyboard.press("Enter")
    const domain = (await target.getAttribute("aria-label"))!.replace(/^Citation: /, "").replace(/\. Show this source$/, "")
    await expect(page.getByRole("dialog")).toContainText(domain)
    await expect.poll(() => room(target)).toBeGreaterThanOrEqual(24)
  })

  test("a citation takes a fingertip-sized tap", async ({ page }) => {
    await openLanding(page, PATH)
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
    const cite = cites(page).first()
    await cite.evaluate((el) => scrollTo({ top: scrollY + el.getBoundingClientRect().top - innerHeight / 3, behavior: "instant" }))
    const box = (await cite.boundingBox())!
    // Just below the chip's visible edge.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height + 12)
    await expect(cite).toHaveAttribute("aria-pressed", "true")
  })
})

test.describe("landing v3 reduced motion, whole page", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("no decorative loop is running", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openLanding(page, PATH)
    await page.locator("#features").scrollIntoViewIfNeeded()
    const running = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect | null)?.getComputedTiming().iterations === Infinity).length
    )
    expect(running).toBe(0)
  })
})
