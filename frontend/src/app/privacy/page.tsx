import type { Metadata } from "next"
import { LegalPage } from "@/components/legal/legal-page"
import { LEGAL_DOCUMENTS } from "@/content/legal/meta"
import { loadLegalDoc } from "@/lib/legal"

const doc = LEGAL_DOCUMENTS["privacy"]

export const metadata: Metadata = {
  title: `${doc.title} · Vettan`,
  description: doc.description,
}

export const dynamic = "force-static"

export default function PrivacyPage() {
  return <LegalPage doc={loadLegalDoc("privacy")} />
}
