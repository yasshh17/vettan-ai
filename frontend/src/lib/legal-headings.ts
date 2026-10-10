// Must match the #anchors used inside the documents.
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

// "1. Scope" -> { number: "01", title: "Scope" }
export function splitHeading(heading: string): { number: string; title: string } {
  const match = heading.match(/^(\d+)\.\s+(.*)$/)
  if (!match) return { number: "", title: heading }
  return { number: match[1].padStart(2, "0"), title: match[2] }
}
