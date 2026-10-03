/**
 * Answers are rendered with ReactMarkdown and must never execute raw HTML. If this
 * fails, rehype-raw (or similar) was added without a sanitizer.
 */
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import ReactMarkdown from "react-markdown"

// Shaped like a real answer; sources can inject text into it.
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
    // Escaped into text, not executed or dropped.
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
