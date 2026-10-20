// The recorded Oct 19, 2026 run behind the landing demo. Throws on a broken fixture
// so the build fails instead of shipping invented or mismatched data.
import raw from "@/content/research-demo/rag-vs-fine-tuning.json"

export interface DemoSource {
  rank: number
  domain: string
  url: string
}

export interface DemoLogEvent {
  at: string
  event: string
}

export interface ResearchDemo {
  label: string
  query: string
  recordedAt: string
  subQueries: string[]
  search: { planned: number; succeeded: number; selectedSources: number; cacheHit: boolean }
  sources: DemoSource[]
  report: { markdown: string }
  timing: {
    pipeline_s: { decomposition: number; search: number; ttft: number; synthesis: number; total: number }
    request_s: {
      total: number
      checkCache: number
      moderationInput: number
      moderationOutput: number
      dbSave: number
    }
  }
  backendLog: DemoLogEvent[]
  derived: { pipelineStartApprox: string; firstTokenApprox: string }
  provenance: { observed: string; notes: string[] }
  missing: string[]
}

export interface Citation {
  index: number
  sourceRank: number
  url: string
  labelAsWritten: string
  // Taken from the URL host, so a typo in the generated link text never reaches a pill.
  displayLabel: string
}

// Presentation only: the replay is compressed and never claims to match the real run.
export const PLAYBACK_MS = { decompose: 450, search: 1250, select: 2100, synthesize: 2900, done: 3800 }

export const STAGES = ["idle", "decompose", "search", "select", "synthesize", "done"] as const
export type Stage = (typeof STAGES)[number]

export function normalizeUrl(url: string): string {
  const u = new URL(url)
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`
}

export function hostOf(url: string): string {
  return new URL(url).hostname
}

export function urlPath(url: string): string {
  const u = new URL(url)
  return u.pathname === "/" ? "" : u.pathname
}

export function monogram(domain: string): string {
  return domain.replace(/^www\./, "").charAt(0).toUpperCase()
}

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g

export function parseCitations(markdown: string, sources: DemoSource[]): Citation[] {
  const byUrl = new Map(sources.map((s) => [normalizeUrl(s.url), s]))
  const out: Citation[] = []
  for (const match of markdown.matchAll(LINK)) {
    const source = byUrl.get(normalizeUrl(match[2]))
    if (!source) continue
    out.push({
      index: out.length + 1,
      sourceRank: source.rank,
      url: source.url,
      labelAsWritten: match[1],
      displayLabel: source.domain,
    })
  }
  return out
}

export function citationCounts(citations: Citation[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const c of citations) counts.set(c.sourceRank, (counts.get(c.sourceRank) ?? 0) + 1)
  return counts
}

// Fixed UTC formatting: the same string on the server and in every browser.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export function formatRecordedAt(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function formatRecordedDate(iso: string): string {
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

// Seconds from the first backend log line. Positions on one clock, not durations to add up.
export function logOffsets(log: DemoLogEvent[]): { event: string; at: string; offsetS: number }[] {
  const start = Date.parse(log[0].at)
  return log.map((e) => ({ ...e, offsetS: Math.round((Date.parse(e.at) - start) / 10) / 100 }))
}

// The paragraph right after a bold heading line, used for the hero excerpt.
export function paragraphAfter(markdown: string, heading: string): string {
  const blocks = markdown.split(/\n{2,}/)
  const i = blocks.findIndex((b) => b.trim() === `**${heading}**`)
  if (i === -1 || i + 1 >= blocks.length) throw new Error(`Report has no paragraph after "${heading}"`)
  return blocks[i + 1]
}

export type Span =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "cite"; citation: Citation }
  | { kind: "link"; text: string; url: string }

export type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "list"; items: Span[][] }

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const BOLD_LINE = /^\*\*([^*]+)\*\*$/

// The report uses a small markdown subset: bold lines as headings, paragraphs, one bullet
// list, inline bold and links. Rendering it directly keeps react-markdown off the landing page.
export function tokenizeReport(markdown: string, sources: DemoSource[]): Block[] {
  const byUrl = new Map(sources.map((s) => [normalizeUrl(s.url), s]))
  let citeIndex = 0
  const spans = (text: string): Span[] => {
    const out: Span[] = []
    let last = 0
    for (const m of text.matchAll(INLINE)) {
      if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) })
      if (m[1] !== undefined) {
        out.push({ kind: "strong", text: m[1] })
      } else {
        const source = byUrl.get(normalizeUrl(m[3]))
        if (source) {
          citeIndex += 1
          out.push({
            kind: "cite",
            citation: { index: citeIndex, sourceRank: source.rank, url: source.url, labelAsWritten: m[2], displayLabel: source.domain },
          })
        } else {
          out.push({ kind: "link", text: m[2], url: m[3] })
        }
      }
      last = m.index! + m[0].length
    }
    if (last < text.length) out.push({ kind: "text", text: text.slice(last) })
    return out
  }

  return markdown
    .split(/\n{2,}/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((block, i): Block => {
      const bold = BOLD_LINE.exec(block)
      if (bold) return i === 0 ? { kind: "title", text: bold[1] } : { kind: "heading", text: bold[1] }
      if (block.split("\n").every((line) => line.startsWith("- "))) {
        return { kind: "list", items: block.split("\n").map((line) => spans(line.slice(2))) }
      }
      return { kind: "paragraph", spans: spans(block.replace(/\n/g, " ")) }
    })
}

const UNSUPPORTED = /^#{1,6} |```|`[^`]+`|!\[|^\s*\||^\s*\d+\. |^> /m

// The first `count` sentences of a paragraph, verbatim. Splits only after a full stop that's
// followed by a capital letter, so links and abbreviations inside a sentence stay whole.
export function leadingSentences(paragraph: string, count: number): string {
  return paragraph.split(/(?<=\.)\s+(?=[A-Z])/).slice(0, count).join(" ")
}

export function validateDemo(demo: ResearchDemo): ResearchDemo {
  const fail = (msg: string) => {
    throw new Error(`Research demo fixture: ${msg}`)
  }
  if (demo.subQueries.length !== demo.search.planned) fail("sub-query count differs from search.planned")
  if (demo.sources.length !== demo.search.selectedSources) fail("source count differs from search.selectedSources")
  demo.sources.forEach((s, i) => {
    if (s.rank !== i + 1) fail(`source ${s.url} is out of rank order`)
    if (!s.url.startsWith("https://")) fail(`source ${s.url} is not https`)
    if (hostOf(s.url) !== s.domain) fail(`domain ${s.domain} is not the host of ${s.url}`)
  })
  if (!demo.report.markdown.trim()) fail("report is empty")
  if (/Sources\(\d+\)|\*\*Open\*\*/.test(demo.report.markdown)) fail("report still contains export UI chrome")
  if (UNSUPPORTED.test(demo.report.markdown)) fail("report uses markdown the landing renderer doesn't support")
  const cited = new Set(parseCitations(demo.report.markdown, demo.sources).map((c) => c.sourceRank))
  if (cited.size !== demo.sources.length) fail("a selected source is never cited in the report")
  const times = demo.backendLog.map((e) => Date.parse(e.at))
  if (times.some((t, i) => Number.isNaN(t) || (i > 0 && t < times[i - 1]))) fail("backend log is not in time order")
  return demo
}

// The bullets of the list right after a bold heading line, without their "- " markers.
export function listItemsAfter(markdown: string, heading: string): string[] {
  const block = paragraphAfter(markdown, heading)
  const lines = block.split("\n")
  if (!lines.every((line) => line.startsWith("- "))) throw new Error(`Report has no list after "${heading}"`)
  return lines.map((line) => line.slice(2))
}

// The one sentence of a paragraph that starts with `prefix`, verbatim.
export function sentenceStarting(paragraph: string, prefix: string): string {
  const sentence = paragraph.split(/(?<=\.)\s+(?=[A-Z])/).find((s) => s.startsWith(prefix))
  if (!sentence) throw new Error(`Report has no sentence starting "${prefix}"`)
  return sentence
}

// The report without its title line: the page shows the question in its own heading.
export function reportBody(blocks: Block[]): Block[] {
  return blocks[0]?.kind === "title" ? blocks.slice(1) : blocks
}

export const DEMO: ResearchDemo = validateDemo(raw as ResearchDemo)
export const DEMO_CITATIONS: Citation[] = parseCitations(DEMO.report.markdown, DEMO.sources)
export const HERO_HEADING = "Understanding RAG and Its Advantages"
export const TAKEAWAYS_HEADING = "Key Takeaways"
export const EXAMPLE_HEADING = "The Case for Fine-Tuning"

// v62 excerpts, all verbatim. The hero answers the question asked (the first takeaway, then the
// cited sentence about training time); the example section shows a different passage.
export const HERO_TAKEAWAY = listItemsAfter(DEMO.report.markdown, TAKEAWAYS_HEADING)[0]
export const HERO_CITED_SENTENCE = sentenceStarting(paragraphAfter(DEMO.report.markdown, HERO_HEADING), "Notably, RAG requires")
export const STAGE_RESULT_EXCERPT = leadingSentences(paragraphAfter(DEMO.report.markdown, HERO_HEADING), 2)
export const EXAMPLE_EXCERPT = paragraphAfter(DEMO.report.markdown, EXAMPLE_HEADING)
