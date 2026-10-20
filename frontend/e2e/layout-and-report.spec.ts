import { VIEWPORTS, expect, headerClear, openLanding, rect, settle, test } from "./fixtures"

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test("no horizontal scroll, header clearance measured", async ({ page }) => {
      await openLanding(page)
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
      const clear = await headerClear(page)
      const cssVar = await page.evaluate(() =>
        document.querySelector<HTMLElement>(".lv2")!.style.getPropertyValue("--header-clear")
      )
      expect(cssVar).toBe(`${clear}px`)
    })

    test("Show less keeps the toggle focused and in view, heading on the clearance line where it fits", async ({ page }) => {
      await openLanding(page)
      const toggle = page.getByRole("button", { name: "Read the full report" })
      await toggle.click()
      const showLess = page.getByRole("button", { name: "Show less" })
      // Read to the end of the report, then collapse from the keyboard.
      await showLess.evaluate((el) => el.scrollIntoView({ block: "center" }))
      await settle(page)
      await showLess.focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("button", { name: "Read the full report" })).toBeFocused()
      await settle(page)

      const clear = await headerClear(page)
      const h = vp.height
      const heading = await rect(page, "#example-title")
      const btn = await rect(page, "button[aria-controls='full-report']")
      // The focused toggle: fully visible, 16px clear of the bottom, never under the header.
      expect(btn.top).toBeGreaterThanOrEqual(clear - 1)
      expect(btn.bottom).toBeLessThanOrEqual(h - 16 + 1)
      const fits = btn.top - heading.top + clear + btn.height <= h - 16
      if (fits) {
        expect(Math.abs(heading.top - clear)).toBeLessThanOrEqual(1)
      } else {
        // 360×780 case: the toggle wins and the heading slides under the header.
        expect(Math.abs(btn.bottom - (h - 16))).toBeLessThanOrEqual(1)
      }
      test.info().annotations.push({ type: "show-less", description: fits ? "heading on line" : "toggle wins" })
    })

    test("selecting a citation reveals its source without losing the reader's place", async ({ page }) => {
      await openLanding(page)
      await page.getByRole("button", { name: "Read the full report" }).click()
      const matillion = page.locator("#example button[data-source-rank='5']").first()
      await matillion.evaluate((el) => el.scrollIntoView({ block: "center" }))
      await settle(page)
      const sticky = vp.width >= 1024
      const before = await page.evaluate(() => window.scrollY)
      await matillion.click()
      await expect(matillion).toHaveAttribute("aria-pressed", "true")
      await settle(page)
      const clear = await headerClear(page)
      const card = await rect(page, "#source-5")
      await expect(page.locator("#source-5")).toContainText("Selected")
      await expect(page.locator("#example [aria-live='polite']")).toHaveText("www.matillion.com selected, source 5 of 5")
      if (sticky) {
        // The panel scrolls on its own; the page stays where the reader is.
        expect(await page.evaluate(() => window.scrollY)).toBe(before)
        const panel = await rect(page, "[data-lv2-own-scroll]")
        expect(card.top).toBeGreaterThanOrEqual(panel.top - 1)
        expect(card.bottom).toBeLessThanOrEqual(panel.bottom + 1)
        await expect(page.getByRole("button", { name: "Back to the citation" })).toBeHidden()
      } else {
        // Card top lands on the clearance line, name and Selected below the header.
        expect(Math.abs(card.top - clear)).toBeLessThanOrEqual(2)
        const back = page.getByRole("button", { name: "Back to the citation" })
        await back.click()
        await settle(page)
        await expect(matillion).toBeFocused()
        const cite = await matillion.evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { top: r.top, height: r.height }
        })
        const expected = Math.max(clear, Math.round((vp.height + clear - cite.height) / 2))
        expect(Math.abs(cite.top - expected)).toBeLessThanOrEqual(2)
        expect(cite.top).toBeGreaterThanOrEqual(clear - 1)
      }
    })
  })
}

test.describe("sticky sources panel", () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test("has its own scroll, capped below the header", async ({ page }) => {
    await openLanding(page)
    const panel = page.locator("[data-lv2-own-scroll]")
    const style = await panel.evaluate((el) => {
      const s = getComputedStyle(el)
      return { position: s.position, overflowY: s.overflowY, maxHeight: s.maxHeight, top: s.top }
    })
    expect(style).toEqual({ position: "sticky", overflowY: "auto", maxHeight: `${768 - 112}px`, top: "96px" })
  })
})
