// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  DEMO,
  DEMO_CITATIONS,
  citationCounts,
  formatRecordedAt,
  logOffsets,
  paragraphAfter,
  parseCitations,
  validateDemo,
  HERO_HEADING,
  EXAMPLE_EXCERPT,
  HERO_CITED_SENTENCE,
  HERO_TAKEAWAY,
  STAGE_RESULT_EXCERPT,
  formatRecordedDate,
  listItemsAfter,
  reportBody,
  sentenceStarting,
  tokenizeReport,
  type ResearchDemo,
} from "@/lib/research-demo"

const fixturePath = path.resolve(__dirname, "../../content/research-demo/rag-vs-fine-tuning.json")
const fixtureText = readFileSync(fixturePath, "utf8")

describe("recorded research demo fixture", () => {
  it("keeps the exact query and the four logged sub-queries in order", () => {
    expect(DEMO.query).toBe("RAG vs fine-tuning: Which should a small team choose?")
    expect(DEMO.subQueries).toEqual([
      "RAG vs fine-tuning for small teams",
      "cost-effectiveness of RAG systems 2025",
      "performance comparison RAG fine-tuning",
      "best practices for implementing RAG",
    ])
    expect(DEMO.search).toEqual({ planned: 4, succeeded: 4, selectedSources: 5, cacheHit: false })
  })

  it("lists five https sources in rank order with the URL host as domain", () => {
    expect(DEMO.sources.map((s) => s.domain)).toEqual([
      "arxiv.org",
      "orkes.io",
      "montecarlo.ai",
      "www.ibm.com",
      "www.matillion.com",
    ])
    DEMO.sources.forEach((s, i) => {
      expect(s.rank).toBe(i + 1)
      expect(s.url.startsWith("https://")).toBe(true)
      expect(new URL(s.url).hostname).toBe(s.domain)
    })
  })

  it("parses all eight report citations and matches each to a source", () => {
    expect(DEMO_CITATIONS).toHaveLength(8)
    expect(DEMO_CITATIONS.map((c) => c.sourceRank)).toEqual([4, 3, 2, 5, 3, 4, 5, 1])
    const counts = citationCounts(DEMO_CITATIONS)
    expect([...counts.entries()].sort()).toEqual([[1, 1], [2, 1], [3, 2], [4, 2], [5, 2]])
  })

  it("keeps the generated link text but labels pills from the URL host", () => {
    const orkes = DEMO_CITATIONS.find((c) => c.sourceRank === 2)!
    expect(orkes.labelAsWritten).toBe("Source: orkeso.io")
    expect(orkes.displayLabel).toBe("orkes.io")
    expect(DEMO.report.markdown).toContain("[Source: orkeso.io](https://orkes.io/blog/rag-best-practices)")
  })

  it("holds the report body only, without export chrome or placeholders", () => {
    const md = DEMO.report.markdown
    expect(md.startsWith("**RAG vs fine-tuning: Which should a small team choose?**")).toBe(true)
    expect(md.endsWith("the specific use cases they aim to address.")).toBe(true)
    expect(md).not.toMatch(/Sources\(5\)|\*\*Open\*\*|^# /m)
    expect(md).not.toMatch(/\[[A-Z ]+\]|example\.(org|com)|source-\d\.example|TODO/)
  })

  it("orders the backend log on Oct 19 and its span matches the measured request", () => {
    const times = DEMO.backendLog.map((e) => e.at)
    expect(times.every((t) => t.startsWith("2026-10-19T"))).toBe(true)
    expect([...times].sort()).toEqual(times)
    const offsets = logOffsets(DEMO.backendLog)
    expect(offsets.at(-1)!.offsetS).toBeCloseTo(20.16, 1)
    expect(Math.abs(offsets.at(-1)!.offsetS - DEMO.timing.request_s.total)).toBeLessThan(0.02)
  })

  it("keeps pipeline and request timings as separate measured scopes", () => {
    expect(DEMO.timing.pipeline_s.total).toBe(16.5)
    expect(DEMO.timing.request_s.total).toBe(20.16)
    // The fixture never records a combined figure.
    expect(fixtureText).not.toMatch(/36\.66|"combined|"sum/)
  })

  it("ships no session, user or infrastructure identifiers", () => {
    expect(fixtureText).not.toMatch(/620974ae|f7528c05|04e08a76|supabase\.co|mzyd|ip=/i)
    expect(fixtureText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })

  it("records no sub-query to source mapping", () => {
    DEMO.sources.forEach((s) => expect(Object.keys(s).sort()).toEqual(["domain", "rank", "url"]))
    expect(DEMO.missing).toContain("which sub-query found which source")
  })

  it("formats the recorded time in UTC", () => {
    expect(formatRecordedAt(DEMO.recordedAt)).toBe("Oct 19, 2026, 08:59 UTC")
  })

  it("finds the hero excerpt with its two citations", () => {
    const excerpt = paragraphAfter(DEMO.report.markdown, HERO_HEADING)
    expect(parseCitations(excerpt, DEMO.sources).map((c) => c.displayLabel)).toEqual([
      "www.ibm.com",
      "montecarlo.ai",
    ])
  })

  it("rejects a fixture whose sources drift from the record", () => {
    const broken: ResearchDemo = structuredClone(DEMO)
    broken.sources[3].domain = "ibm.com"
    expect(() => validateDemo(broken)).toThrow(/not the host/)
    const chrome: ResearchDemo = structuredClone(DEMO)
    chrome.report.markdown += "\n\n**Sources(5)**"
    expect(() => validateDemo(chrome)).toThrow(/chrome/)
  })

  it("pins the recorded timings shown on the page", () => {
    expect(DEMO.timing.pipeline_s).toEqual({ decomposition: 3.1, search: 2.8, ttft: 1.2, synthesis: 10.7, total: 16.5 })
    expect(DEMO.timing.request_s.total).toBe(20.16)
    expect(formatRecordedDate(DEMO.recordedAt)).toBe("Oct 19, 2026")
  })
})

describe("v62 excerpts, verbatim from the report", () => {
  it("hero: the first key takeaway", () => {
    expect(HERO_TAKEAWAY).toBe(
      "**RAG is more accessible** for small teams, requiring less infrastructure and expertise compared to fine-tuning."
    )
  })

  it("hero: the cited sentence about training time, ending on its montecarlo.ai citation", () => {
    expect(HERO_CITED_SENTENCE.startsWith("Notably, RAG requires minimal training time beyond the initial indexing of documents")).toBe(true)
    expect(parseCitations(HERO_CITED_SENTENCE, DEMO.sources).map((c) => c.displayLabel)).toEqual(["montecarlo.ai"])
    expect(DEMO.report.markdown).toContain(HERO_CITED_SENTENCE)
  })

  it("stage result: the two opening sentences, citing www.ibm.com", () => {
    expect(STAGE_RESULT_EXCERPT.startsWith("RAG enhances LLMs by connecting them")).toBe(true)
    expect(parseCitations(STAGE_RESULT_EXCERPT, DEMO.sources).map((c) => c.displayLabel)).toEqual(["www.ibm.com"])
  })

  it("example section: The Case for Fine-Tuning, citing montecarlo.ai and www.ibm.com", () => {
    expect(EXAMPLE_EXCERPT.startsWith("Fine-tuning involves retraining a model on a specific dataset")).toBe(true)
    expect(parseCitations(EXAMPLE_EXCERPT, DEMO.sources).map((c) => c.displayLabel)).toEqual(["montecarlo.ai", "www.ibm.com"])
  })

  it("full report body drops only the title line, which the page shows as its own heading", () => {
    const blocks = tokenizeReport(DEMO.report.markdown, DEMO.sources)
    expect(blocks[0]).toEqual({ kind: "title", text: DEMO.query })
    expect(reportBody(blocks)).toEqual(blocks.slice(1))
  })

  it("throws instead of inventing text when the report changes shape", () => {
    expect(() => listItemsAfter(DEMO.report.markdown, "Overview of RAG vs. Fine-Tuning for Small Teams")).toThrow(/no list/)
    expect(() => sentenceStarting("One. Two.", "Three")).toThrow(/no sentence/)
  })
})
