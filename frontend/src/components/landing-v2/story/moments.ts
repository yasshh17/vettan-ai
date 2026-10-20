export interface Moment {
  id: string
  label: string
  title: string
  body: string
}

// v62 copy. Claims hold for the recorded run (see src/content/research-demo).
export const MOMENTS: Moment[] = [
  {
    id: "question",
    label: "Question",
    title: "You ask in plain language",
    body: "No keywords or operators. Ask it the way you would ask a colleague.",
  },
  {
    id: "plan",
    label: "Plan",
    title: "It splits the question into focused searches",
    body: "One search rarely covers a question like this. Vettan splits it into focused searches, one for each angle.",
  },
  {
    id: "search",
    label: "Search",
    title: "The searches run in parallel",
    body: "The same four searches run at the same time instead of one after another. In this run, all four succeeded.",
  },
  {
    id: "sources",
    label: "Sources",
    title: "The most relevant pages are kept",
    body: "Duplicates are dropped and results are ranked, so only the most relevant pages are read.",
  },
  {
    id: "write",
    label: "Write",
    title: "The report is written from those pages",
    body: "Citations go into the text as it is written, next to the points they support.",
  },
  {
    id: "result",
    label: "Result",
    title: "Each cited point links back to its page",
    body: "You can open any source and check the claim yourself.",
  },
]
