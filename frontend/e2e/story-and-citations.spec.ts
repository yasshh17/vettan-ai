import type { Page } from "@playwright/test"
import { expect, finishReplay, openLanding, settle, test } from "./fixtures"

const stage = (page: Page) => page.locator("[data-stage-moment]")

async function goToMoment(page: Page, n: number, label: string) {
  await page.getByRole("button", { name: `${n}. ${label}` }).click()
  await expect(stage(page)).toHaveAttribute("data-stage-moment", String(n - 1))
  await settle(page)
  // Let the slowest pose finish (0.9s path + 0.3s delays).
  await page.waitForTimeout(1300)
}

// Records layout shifts from now on, including ones right after input.
async function watchShifts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __shifts: number[] }
    w.__shifts = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEntry[] & { value: number }[]) w.__shifts.push((e as unknown as { value: number }).value)
    }).observe({ type: "layout-shift", buffered: false })
  })
}
const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts)

async function boxes(page: Page, selectors: string[]) {
  return page.evaluate(
    (sels) =>
      sels.map((s) => {
        const r = document.querySelector(s)!.getBoundingClientRect()
        return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]
      }),
    selectors
  )
}

for (const vp of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`Stage 06 citation regression ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp })

    test("IBM citation: check appears, nothing shifts, and the page keeps scrolling and responding", async ({ page }) => {
      await openLanding(page)
      await page.locator("#how").scrollIntoViewIfNeeded()
      await goToMoment(page, 6, "Result")

      const ibm = stage(page).getByRole("button", { name: "Citation: www.ibm.com. Show this source" })
      await expect(ibm).toBeVisible()
      const chipLinks = stage(page).getByRole("link", { name: /^\S+ ×\d.* \(opens in a new tab\)$/ })
      await expect(chipLinks).toHaveCount(5)
      await ibm.evaluate((el) => el.setAttribute("data-e2e", "ibm"))
      await ibm.evaluate((el) => el.closest("p")!.setAttribute("data-e2e", "para"))
      await chipLinks.nth(3).evaluate((el) => el.setAttribute("data-e2e", "chip4"))
      await chipLinks.nth(3).evaluate((el) => el.parentElement!.setAttribute("data-e2e", "chips"))
      const sel = ["[data-e2e=ibm]", "[data-e2e=para]", "[data-e2e=chip4]", "[data-e2e=chips]"]
      const before = await boxes(page, sel)
      await watchShifts(page)

      await ibm.click()
      await expect(ibm).toHaveAttribute("aria-pressed", "true")
      await expect(ibm.locator("[data-citation-check]")).toBeVisible()
      await expect(chipLinks.nth(3)).toContainText(", selected")
      await page.waitForTimeout(300)
      expect(await boxes(page, sel)).toEqual(before)
      expect(await shifts(page)).toEqual([])

      // Wheel scrolling still moves the page.
      const y0 = await page.evaluate(() => window.scrollY)
      await page.mouse.move(vp.width - 200, vp.height / 2)
      await page.mouse.wheel(0, 400)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 + 100)

      // Stage navigation still works, both ways.
      await goToMoment(page, 1, "Question")
      await goToMoment(page, 6, "Result")

      // Page Up from the keyboard.
      // Focus the page itself (a click on empty margin) without moving it.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      const y1 = await page.evaluate(() => window.scrollY)
      await page.keyboard.press("PageUp")
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(y1 - 100)
      await goToMoment(page, 6, "Result")

      // Keyboard selection and repeated toggling stay consistent.
      await ibm.focus()
      for (let i = 0; i < 5; i++) {
        const was = await ibm.getAttribute("aria-pressed")
        await page.keyboard.press(i % 2 ? "Space" : "Enter")
        await expect(ibm).toHaveAttribute("aria-pressed", was === "true" ? "false" : "true")
      }
      for (let i = 0; i < 5; i++) await ibm.click()
      await expect(ibm).toHaveAttribute("aria-pressed", "true")
      expect(await boxes(page, sel.slice(0, 2))).toEqual(before.slice(0, 2))
    })

    test("other citations: hero and report select without shifting layout", async ({ page }) => {
      await openLanding(page)
      await finishReplay(page)
      const hero = page.locator("#start").getByRole("button", { name: "Citation: montecarlo.ai. Show this source" })
      await expect(hero).toBeVisible()
      await hero.evaluate((el) => el.scrollIntoView({ block: "center" }))
      await settle(page)
      await hero.evaluate((el) => el.closest("p")!.setAttribute("data-e2e", "hero-para"))
      const heroBefore = await boxes(page, ["[data-e2e=hero-para]"])
      await watchShifts(page)
      await hero.click()
      await expect(hero).toHaveAttribute("aria-pressed", "true")
      await expect(page.locator("#start").getByText("Cited", { exact: true })).toBeVisible()
      await page.waitForTimeout(200)
      expect(await boxes(page, ["[data-e2e=hero-para]"])).toEqual(heroBefore)

      expect(await shifts(page)).toEqual([])

      // Opening the report moves what's below it, by request; watch only the selections.
      await page.getByRole("button", { name: "Read the full report" }).click()
      const report = page.locator("#example").getByRole("button", { name: /^Citation: / })
      await expect(report).toHaveCount(8)
      await settle(page)
      await watchShifts(page)
      for (let i = 0; i < 8; i++) {
        const c = report.nth(i)
        await c.evaluate((el) => el.scrollIntoView({ block: "center" }))
        await settle(page)
        await c.evaluate((el) => el.closest("p, li")!.setAttribute("data-e2e", "rp"))
        const b = await boxes(page, ["[data-e2e=rp]"])
        await c.evaluate((el) => (el as HTMLButtonElement).click())
        await expect(c).toHaveAttribute("aria-pressed", "true")
        expect(await boxes(page, ["[data-e2e=rp]"])).toEqual(b)
        await c.evaluate((el) => el.closest("[data-e2e=rp]")!.removeAttribute("data-e2e"))
      }
      // Clicks count as recent input for CLS; this is stricter: no shift at all.
      expect(await shifts(page)).toEqual([])
    })
  })
}

test.describe("story and hero", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("scrolling through the steps walks all six moments, forwards and back", async ({ page }) => {
    await openLanding(page)
    const seen = new Set<string>()
    for (let i = 1; i <= 6; i++) {
      await page.locator(`#moment-${i}`).evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - innerHeight * 0.4 }))
      await settle(page)
      seen.add((await stage(page).getAttribute("data-stage-moment"))!)
    }
    expect([...seen]).toEqual(["0", "1", "2", "3", "4", "5"])
    await page.locator("#moment-2").evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - innerHeight * 0.4 }))
    await settle(page)
    await expect(stage(page)).toHaveAttribute("data-stage-moment", "1")
    await expect(page.getByRole("button", { name: "2. Plan" })).toHaveAttribute("aria-current", "step")
  })

  test("hero replays once, Skip jumps to the end, Replay starts again", async ({ page }) => {
    await openLanding(page)
    const panel = page.locator("[data-playback-stage]")
    await expect(panel).toHaveAttribute("data-playback-stage", "5", { timeout: 8000 })
    await page.getByRole("button", { name: "Replay the recorded example" }).click()
    await expect(panel).not.toHaveAttribute("data-playback-stage", "5")
    await page.getByRole("button", { name: "Skip to the end of the replay" }).click()
    await expect(panel).toHaveAttribute("data-playback-stage", "5")
    await expect(page.getByText("From the report, verbatim")).toBeVisible()
  })

  test("tab order follows the page and never lands in a hidden stage layer", async ({ page }) => {
    await openLanding(page)
    expect(await page.locator("[tabindex]:not([tabindex='-1']):not([tabindex='0'])").count()).toBe(0)
    let prev: string | null = null
    const problems: string[] = []
    let first: number | null = null
    let visited = 0
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press("Tab")
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        // Skip the browser chrome and Next's dev overlay; only the landing page counts.
        if (!el || el === document.body || !el.closest(".lv2")) return null
        const hiddenLayer = el.closest("[inert], [aria-hidden='true']")
        // The question input draws its ring on the field wrapper, around the input and button.
        const ringOwner = el.matches(".lv2-field input") ? el.closest(".lv2-field")! : el
        const style = getComputedStyle(el)
        const ring = getComputedStyle(ringOwner)
        const all = [...document.querySelectorAll("a, button, input")]
        return {
          index: all.indexOf(el),
          hiddenLayer: Boolean(hiddenLayer),
          visibility: style.visibility,
          outline: ring.outlineStyle,
          name: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}`,
        }
      })
      if (!info) continue
      // Tab wrapped from the footer back to the top: the whole page has been walked.
      if (first !== null && info.index === first) break
      if (first === null) first = info.index
      visited++
      if (info.hiddenLayer) problems.push(`${info.name}: inside a hidden layer`)
      if (info.visibility !== "visible") problems.push(`${info.name}: not visible`)
      if (info.outline === "none") problems.push(`${info.name}: no focus ring`)
      if (prev !== null && info.index <= Number(prev)) problems.push(`${info.name}: out of DOM order`)
      prev = String(info.index)
    }
    expect(problems).toEqual([])
    expect(visited).toBeGreaterThan(30)
    test.info().annotations.push({ type: "tab stops", description: String(visited) })
  })
})
