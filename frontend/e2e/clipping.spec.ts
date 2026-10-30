import type { Page } from "@playwright/test"
import { VIEWPORTS, expect, openLanding, test } from "./fixtures"

// Content that runs past the screen edge or out of a box that clips it. The page-level
// scrollWidth check can't see this: the root uses overflow-x: clip, which hides it silently.
async function clippedContent(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out: string[] = []
    const clips = (el: Element) => {
      const s = getComputedStyle(el)
      return ["hidden", "clip", "auto", "scroll"].includes(s.overflowX)
    }
    const candidates = document.querySelectorAll<HTMLElement>(
      "main a, main button, main input, main p, main h1, main h2, main h3, main h4, main li, main dd, main dt"
    )
    for (const el of candidates) {
      const s = getComputedStyle(el)
      if (s.display === "none" || s.visibility === "hidden") continue
      if (el.closest("[inert], [aria-hidden='true'], .sr-only")) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const name = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}"`
      if (r.left < -1 || r.right > vw + 1) {
        out.push(`${name} outside the viewport (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`)
        continue
      }
      // Inside every ancestor that clips sideways (an ellipsis inside its own box is fine).
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (!clips(a)) continue
        const ar = a.getBoundingClientRect()
        if (r.left < ar.left - 1 || r.right > ar.right + 1) {
          out.push(`${name} cut off by ${a.tagName.toLowerCase()}.${(a.className || "").toString().split(" ")[0]}`)
          break
        }
      }
    }
    return out
  })
}

for (const vp of VIEWPORTS) {
  test(`nothing is cut off on the homepage at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    // Final states, so nothing is mid-animation when measured.
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openLanding(page, "/")
    expect(await clippedContent(page)).toEqual([])
  })

  test(`nothing is cut off in v62 at ${vp.width}x${vp.height}, report collapsed and expanded`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openLanding(page, "/preview/landing")
    expect(await clippedContent(page)).toEqual([])
    await page.getByRole("button", { name: "Read the full report" }).click()
    await expect(page.getByRole("button", { name: "Show less" })).toBeVisible()
    expect(await clippedContent(page)).toEqual([])
  })
}
