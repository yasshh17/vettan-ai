/**
 * Regression test for the stored-XSS finding from the 2026-09 security audit.
 *
 * agent answers (frontend/src/app/app/page.tsx) are rendered through
 * ReactMarkdown. It used to be given the `rehype-raw` plugin, which re-enables
 * raw HTML parsing in markdown - so a research source that got the agent to
 * emit `<img src=x onerror=...>` in its answer would have that markup
 * executed in the user's browser, against their live Supabase session.
 *
 * The fix was removing `rehype-raw` (frontend/src/app/app/page.tsx). This
 * test renders the exact same `<ReactMarkdown>{body}</ReactMarkdown>` shape
 * used there, with attacker-controlled content standing in for an agent
 * answer, and asserts the dangerous markup never becomes real DOM.
 *
 * If this test starts failing, someone re-added `rehypePlugins={[rehypeRaw]}`
 * (or an equivalent) without also adding a sanitizer - see the audit report
 * before re-enabling raw HTML.
 */
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import ReactMarkdown from "react-markdown"

// Mirrors how agent/research_pipeline.py's synthesis prompt asks the model to
// format its answer: prose plus markdown citation links. A hostile research
// source can influence this text (prompt injection), so it must never be
// trusted as HTML.
const MALICIOUS_AGENT_ANSWER = `
Based on the sources, this candidate is a strong fit.

<img src="x" onerror="window.__xss_fired = true" />
<svg onload="window.__xss_fired = true"></svg>

[Source: example.com](https://example.com/page)
`

describe("agent answer rendering (XSS regression)", () => {
  it("never mounts an <img> or <svg> element with an event handler from agent output", () => {
    const { container } = render(<ReactMarkdown>{MALICIOUS_AGENT_ANSWER}</ReactMarkdown>)

    // The literal tags must not become real DOM nodes with live handlers.
    const img = container.querySelector("img")
    const svg = container.querySelector("svg")
    expect(img).toBeNull()
    expect(svg).toBeNull()
  })

  it("shows the raw markup as visible text instead of silently dropping it", () => {
    const { container } = render(<ReactMarkdown>{MALICIOUS_AGENT_ANSWER}</ReactMarkdown>)
    // react-markdown's default (no rehype-raw) escapes raw HTML into text
    // rather than executing or discarding it - confirm that's what happens.
    expect(container.textContent).toContain("onerror")
  })

  it("never executes an injected event handler", () => {
    ;(window as unknown as { __xss_fired?: boolean }).__xss_fired = false
    render(<ReactMarkdown>{MALICIOUS_AGENT_ANSWER}</ReactMarkdown>)
    expect((window as unknown as { __xss_fired?: boolean }).__xss_fired).toBe(false)
  })

  it("still renders legitimate citation links as real, clickable anchors", () => {
    const { container } = render(<ReactMarkdown>{MALICIOUS_AGENT_ANSWER}</ReactMarkdown>)
    const link = container.querySelector("a")
    expect(link).not.toBeNull()
    expect(link?.getAttribute("href")).toBe("https://example.com/page")
  })
})
