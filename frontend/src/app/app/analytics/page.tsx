import type { Metadata } from "next"
import { AdminDashboard } from "@/components/analytics/admin-dashboard"

// Admins only: the backend refuses everyone else, and the page then shows not found.
export const metadata: Metadata = {
  title: "Analytics · Vettan",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

export default function AnalyticsPage() {
  return <AdminDashboard />
}
