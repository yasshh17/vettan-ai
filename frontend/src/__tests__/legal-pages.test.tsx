import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LEGAL_ORDER, type LegalSlug } from "@/content/legal/meta"
import { fillPlaceholders, loadLegalDoc, smartQuotes } from "@/lib/legal"
import { LegalMarkdown } from "@/components/legal/legal-markdown"
import { RefusalBanner } from "@/components/research/refusal-banner"
import { SignUpConsent } from "@/components/legal/legal-links"

afterEach(cleanup)

function renderDoc(slug: LegalSlug) {
  const doc = loadLegalDoc(slug)
  const { container } = render(
    <>
      <LegalMarkdown>{doc.intro}</LegalMarkdown>
      <LegalMarkdown variant="keyPoints">{doc.keyPoints}</LegalMarkdown>
      <LegalMarkdown>{doc.body}</LegalMarkdown>
    </>
  )
  // LegalPage renders this one, not the markdown.
  const ids = new Set(["key-points", ...Array.from(container.querySelectorAll("[id]"), (el) => el.id)])
  const html = container.innerHTML
  cleanup()
  return { doc, ids, container, html }
}

describe("legal documents", () => {
  it.each(LEGAL_ORDER)("%s: every placeholder is filled", (slug) => {
    const { doc, html } = renderDoc(slug)
    expect(html).not.toContain("{{")
    expect(doc.keyPoints.length).toBeGreaterThan(0)
    expect(doc.sections.length).toBeGreaterThan(3)
  })

  it("every in-document and cross-document anchor points to a real heading", () => {
    const ids = Object.fromEntries(LEGAL_ORDER.map((slug) => [slug, renderDoc(slug).ids]))
    const broken: string[] = []
    for (const slug of LEGAL_ORDER) {
      for (const [, page, anchor] of loadLegalDoc(slug).body.matchAll(/\]\((\/[a-z-]+)?#([a-z0-9-]+)\)/g)) {
        const target = (page?.slice(1) as LegalSlug | undefined) ?? slug
        if (!ids[target]?.has(anchor)) broken.push(`${slug} -> ${page ?? ""}#${anchor}`)
      }
    }
    // Linked from Settings.
    if (!ids.privacy.has("7-how-long-we-keep-information")) broken.push("settings -> /privacy#7-…")
    expect(broken).toEqual([])
  })

  it("numbered headings render with their number and a stable id", () => {
    const { container } = render(<LegalMarkdown>{"## 12. Availability and discontinuation"}</LegalMarkdown>)
    const h2 = container.querySelector("h2")
    expect(h2?.id).toBe("12-availability-and-discontinuation")
    expect(h2?.textContent).toContain("12")
    expect(h2?.textContent).toContain("Availability and discontinuation")
  })

  it("the privacy policy's tables render as tables", () => {
    const { html } = renderDoc("privacy")
    expect(html.match(/<table/g)?.length).toBe(4)
    expect(html).toContain("Supabase")
  })

  it("raw HTML in a document is shown as text, never rendered", () => {
    const { container } = render(
      <LegalMarkdown>{'Hi <img src="x" onerror="window.__legal_xss = true" /> there'}</LegalMarkdown>
    )
    expect(container.querySelector("img")).toBeNull()
  })

  it("external links open safely in a new tab; internal ones don't", () => {
    const { container } = render(
      <LegalMarkdown>{"[Tavily](https://tavily.com/privacy) and [Terms](/terms)"}</LegalMarkdown>
    )
    const [external, internal] = Array.from(container.querySelectorAll("a"))
    expect(external.getAttribute("target")).toBe("_blank")
    expect(external.getAttribute("rel")).toBe("noopener noreferrer")
    expect(internal.getAttribute("target")).toBeNull()
  })

  it("rejects an unknown placeholder instead of publishing it", () => {
    expect(() => fillPlaceholders("Contact {{NOT_A_KEY}}")).toThrow(/NOT_A_KEY/)
  })

  it("uses typographic quotes, except inside code", () => {
    expect(smartQuotes('the "Service" and users\' rights `"raw"`')).toBe(
      "the “Service” and users’ rights `\"raw\"`"
    )
  })
})

describe("links into the legal pages", () => {
  it("the sign-up notice links all three documents and asks for 18+", () => {
    const { container } = render(<SignUpConsent />)
    const hrefs = Array.from(container.querySelectorAll("a"), (a) => a.getAttribute("href"))
    expect(hrefs).toEqual(["/terms", "/usage-policy", "/privacy"])
    expect(container.textContent).toContain("18 or older")
    expect(container.textContent).toContain("acknowledge our Privacy Policy")
    container.querySelectorAll("a").forEach((a) => expect(a.getAttribute("target")).toBe("_blank"))
  })

  it("a refusal links to the Usage Policy", () => {
    const { getByRole } = render(
      <RefusalBanner message="This request can't be processed because it may violate our usage policy." />
    )
    expect(getByRole("link", { name: "Read the Usage Policy" }).getAttribute("href")).toBe("/usage-policy")
  })

  it("a self-harm refusal makes the helpline clickable and skips the policy link", () => {
    const { getByRole, queryByRole } = render(
      <RefusalBanner message="You don't have to face it alone. Find a free, confidential helpline at findahelpline.com." />
    )
    expect(getByRole("link", { name: "findahelpline.com" }).getAttribute("href")).toBe(
      "https://findahelpline.com"
    )
    expect(queryByRole("link", { name: "Read the Usage Policy" })).toBeNull()
  })
})
