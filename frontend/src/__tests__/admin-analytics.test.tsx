import { AxiosError, AxiosHeaders } from "axios"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

const authGet = vi.fn()
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authGet: (...a: unknown[]) => authGet(...a),
}))

const { AdminDashboard } = await import("@/components/analytics/admin-dashboard")
type Summary = import("@/components/analytics/admin-dashboard").Summary

const few = (kind: "contributors" | "events") => ({ value: null, hidden: kind, floor: 5 })

function summary(overrides: Partial<Summary> = {}): Summary {
  const dist = { median: 9000, p95: 12000, samples: 3 }
  return {
    period_days: 7,
    truncated: false,
    research: {
      total_requests: 12, completed_requests: 11, failed_requests: 1, cache_hits: 2,
      completion_rate: 0.9167, latency_ms: dist, ttft_ms: dist,
    },
    followups: { total_requests: 3, failed_requests: 0, completion_rate: 1 },
    blocked: { total: 1, by_reason: { moderation: 0, rate_limit: 1, spend_limit: 0 } },
    failures_by_stage: { research: { search: 1 }, followup: {} },
    total_estimated_cost_usd: 0.31,
    daily: [
      { date: "2026-11-25", requests: 4, active_users: few("contributors") },
      { date: "2026-11-26", requests: 8, active_users: few("contributors") },
    ],
    consenting_users: { active: few("contributors") },
    retention: {
      new_users: few("contributors"),
      d1: { eligible: few("contributors"), retained: few("contributors"), rate: few("contributors") },
      d7: { eligible: few("contributors"), retained: few("contributors"), rate: few("contributors") },
      d30: { eligible: few("contributors"), retained: few("contributors"), rate: few("contributors") },
    },
    feedback: { ratings: few("events"), up_rate: few("events") },
    product: {
      total_events: { value: 9 },
      contributors: few("contributors"),
      by_event: {
        chat_opened: { events: { value: 6 }, contributors: few("contributors") },
        audio_generated: { events: few("events"), contributors: few("contributors") },
      },
    },
    health: { ok: true, urgent: false, problems: [], pending_erasures: 0 },
    ...overrides,
  }
}

function refused(status: number, detail = "Not allowed") {
  const headers = new AxiosHeaders()
  return new AxiosError("refused", String(status), undefined, undefined, {
    status, statusText: "", headers, config: { headers }, data: { detail },
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("admin analytics dashboard", () => {
  it("shows not found to anyone the backend refuses", async () => {
    authGet.mockRejectedValue(refused(403))
    render(<AdminDashboard />)
    expect(await screen.findByText("This page could not be found.")).toBeInTheDocument()
    expect(screen.queryByText("Analytics")).not.toBeInTheDocument()
  })

  it("labels hidden cells instead of showing small numbers", async () => {
    authGet.mockResolvedValue(summary())
    render(<AdminDashboard />)
    expect(await screen.findByText("System totals")).toBeInTheDocument()
    expect(screen.getAllByText("fewer than 5 contributors").length).toBeGreaterThan(0)
    expect(screen.getAllByText("fewer than 5 events").length).toBeGreaterThan(0)
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("6")).toBeInTheDocument()
  })

  it("never renders a coded id", async () => {
    authGet.mockResolvedValue(summary())
    const { container } = render(<AdminDashboard />)
    await screen.findByText("System totals")
    expect(container.innerHTML).not.toMatch(/[0-9a-f]{32}/)
  })

  it("puts urgent health problems first, in red", async () => {
    authGet.mockResolvedValue(
      summary({ health: { ok: false, urgent: true, problems: ["erasure_pending", "erasure_urgent"], pending_erasures: 1 } })
    )
    render(<AdminDashboard />)
    const banner = await screen.findByRole("status")
    expect(banner).toHaveTextContent("Urgent")
    expect(banner).toHaveTextContent("erasure_urgent")
    expect(banner.className).toContain("red")
  })

  it("shows the backend's reason when reads can't be logged", async () => {
    authGet.mockRejectedValue(refused(503, "Access logging unavailable"))
    render(<AdminDashboard />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Access logging unavailable")
  })

  it("asks for the chosen period", async () => {
    authGet.mockResolvedValue(summary())
    render(<AdminDashboard />)
    await screen.findByText("System totals")
    fireEvent.click(screen.getByRole("button", { name: "30 days" }))
    await waitFor(() => expect(authGet).toHaveBeenLastCalledWith(expect.stringContaining("days=30")))
  })
})
