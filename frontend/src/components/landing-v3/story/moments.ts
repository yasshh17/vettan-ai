import { MOMENTS as V62, type Moment } from "../../landing-v2/story/moments"

// v62's moments, with the two lines that said Vettan reads whole pages. It works from the
// search results' excerpts of those pages (Tavily content, not the full text).
const FIXES: Record<string, Partial<Moment>> = {
  sources: { body: "Duplicates are dropped and results are ranked, so only excerpts from the most relevant pages are used." },
  write: { title: "The report is written from those excerpts" },
}

export const MOMENTS: Moment[] = V62.map((m) => ({ ...m, ...FIXES[m.id] }))
