import { DEMO, HERO_CITED_SENTENCE, tokenizeReport, type Block } from "@/lib/research-demo"

// The one cited sentence the hero and the story show, and the source it cites.
export const HERO_EXCERPT: Extract<Block, { kind: "paragraph" }> | null = (() => {
  const [block] = tokenizeReport(HERO_CITED_SENTENCE, DEMO.sources)
  return block?.kind === "paragraph" ? block : null
})()

export const HERO_CITED_RANK: number = (() => {
  const cite = HERO_EXCERPT?.spans.find((s) => s.kind === "cite")
  return cite?.kind === "cite" ? cite.citation.sourceRank : 0
})()
