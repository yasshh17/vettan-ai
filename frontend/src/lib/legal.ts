// Throws on a broken document so the build fails instead of shipping it.
import {
  LEGAL_DOCUMENTS,
  LEGAL_VALUES,
  type LegalDocument,
  type LegalSlug,
} from "@/content/legal/meta"
import { PRIVACY } from "@/content/legal/privacy"
import { TERMS } from "@/content/legal/terms"
import { USAGE_POLICY } from "@/content/legal/usage-policy"
import { slugify, splitHeading } from "@/lib/legal-headings"

const SOURCES: Record<LegalSlug, string> = {
  terms: TERMS,
  privacy: PRIVACY,
  "usage-policy": USAGE_POLICY,
}

export interface LegalSection {
  id: string
  number: string
  title: string
}

export interface LoadedLegalDoc extends LegalDocument {
  lastUpdated: string
  intro: string
  keyPoints: string
  body: string
  sections: LegalSection[]
  readingMinutes: number
}

const KEY_POINTS_HEADING = "## Key points"
const WORDS_PER_MINUTE = 225

export function fillPlaceholders(markdown: string): string {
  const values: Record<string, string> = LEGAL_VALUES
  const filled = markdown.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Unknown legal placeholder ${placeholder}`)
    return value
  })
  // Also catches a meta.ts value left as a placeholder.
  if (filled.includes("{{")) throw new Error("Unfilled placeholder in a legal document")
  return filled
}

// Curly quotes, except in code spans.
export function smartQuotes(markdown: string): string {
  return markdown
    .split(/(`[^`]*`)/)
    .map((part) =>
      part.startsWith("`")
        ? part
        : part
            .replace(/(^|[\s([])"/gm, "$1“")
            .replace(/"/g, "”")
            .replace(/(\w)'/g, "$1’")
    )
    .join("")
}

export function parseLegalDoc(slug: LegalSlug, markdown: string): LoadedLegalDoc {
  // The page header shows these.
  const content = smartQuotes(fillPlaceholders(markdown))
    .split("\n")
    .filter((line) => !line.startsWith("# ") && !line.startsWith("**Last updated:**"))
    .join("\n")
    .trim()

  const keyPointsAt = content.indexOf(KEY_POINTS_HEADING)
  if (keyPointsAt === -1) throw new Error(`${slug}.ts has no "${KEY_POINTS_HEADING}" section`)
  const bodyAt = content.indexOf("\n## ", keyPointsAt + KEY_POINTS_HEADING.length)
  if (bodyAt === -1) throw new Error(`${slug}.ts has nothing after its key points`)

  const body = content.slice(bodyAt).trim()
  const sections = body
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => {
      const heading = line.slice(3).trim()
      return { id: slugify(heading), ...splitHeading(heading) }
    })

  return {
    ...LEGAL_DOCUMENTS[slug],
    lastUpdated: LEGAL_VALUES.LAST_UPDATED,
    intro: content.slice(0, keyPointsAt).trim(),
    keyPoints: content.slice(keyPointsAt + KEY_POINTS_HEADING.length, bodyAt).trim(),
    body,
    sections,
    readingMinutes: Math.max(1, Math.round(content.split(/\s+/).length / WORDS_PER_MINUTE)),
  }
}

export function loadLegalDoc(slug: LegalSlug): LoadedLegalDoc {
  return parseLegalDoc(slug, SOURCES[slug])
}
