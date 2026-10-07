// Filled into the documents wherever they say {{KEY}}.

export const LEGAL_VALUES = {
  OPERATOR_NAME: "Yash Tambakhe",
  // TODO: switch to a dedicated address.
  CONTACT_EMAIL: "yasshh17@gmail.com",
  MIN_AGE: "18",
  LAST_UPDATED: "October 6, 2026",
  // Render Hobby plan keeps logs for 7 days.
  LOG_RETENTION_DAYS: "7",
} as const

export type LegalSlug = "terms" | "privacy" | "usage-policy"

export const LEGAL_ORDER: LegalSlug[] = ["terms", "privacy", "usage-policy"]

export interface LegalDocument {
  slug: LegalSlug
  title: string
  shortTitle: string
  description: string
  version: string
}

export const LEGAL_DOCUMENTS: Record<LegalSlug, LegalDocument> = {
  terms: {
    slug: "terms",
    title: "Terms of Service",
    shortTitle: "Terms",
    description: "The agreement between you and Vettan when you use the service.",
    version: "1.0",
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    shortTitle: "Privacy",
    description: "What Vettan collects, why, who processes it, and the choices you have.",
    version: "1.0",
  },
  "usage-policy": {
    slug: "usage-policy",
    title: "Usage Policy",
    shortTitle: "Usage Policy",
    description: "What you can and can’t use Vettan for, and how the rules are enforced.",
    version: "1.0",
  },
}
