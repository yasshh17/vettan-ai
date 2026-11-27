"use client"

import { useEffect, useState, type ReactNode } from "react"
import axios from "axios"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { API_BASE_URL, authGet, withAuthRedirect } from "@/lib/auth-fetch"

// Counts of people and event-only counts arrive as cells; the backend hides small ones.
export type Cell = { value: number | null; hidden?: "contributors" | "events"; floor?: number }

type Distribution = { median: number | null; p95: number | null; samples: number }

export type Summary = {
  period_days: number
  truncated: boolean
  research: {
    total_requests: number
    completed_requests: number
    failed_requests: number
    cache_hits: number
    completion_rate: number | null
    latency_ms: Distribution
    ttft_ms: Distribution
  }
  followups: { total_requests: number; failed_requests: number; completion_rate: number | null }
  blocked: { total: number; by_reason: Record<string, number> }
  failures_by_stage: Record<string, Record<string, number>>
  total_estimated_cost_usd: number
  daily: { date: string; requests: number; active_users: Cell }[]
  consenting_users: { active: Cell }
  retention: { new_users: Cell } & Record<"d1" | "d7" | "d30", { eligible: Cell; retained: Cell; rate: Cell }>
  feedback: { ratings: Cell; up_rate: Cell } | null
  product: {
    total_events: Cell
    contributors: Cell
    by_event: Record<string, { events: Cell; contributors: Cell }>
  }
  health: { ok: boolean; urgent: boolean; problems: string[]; pending_erasures: number | null }
}

const PERIODS = [7, 30, 90] as const

type State =
  | { status: "loading" }
  | { status: "ready"; data: Summary }
  | { status: "not-found" }
  | { status: "error"; message: string }

function cellText(cell: Cell, format: (n: number) => string = String): string {
  if (cell.hidden) return `fewer than ${cell.floor ?? 5} ${cell.hidden}`
  return cell.value === null ? "–" : format(cell.value)
}

const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`)

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="mt-1 text-lg font-medium text-neutral-100">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-neutral-800 bg-neutral-900/60 gap-4">
      <CardHeader>
        <CardTitle className="text-sm text-neutral-300">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function DailyBars({ daily }: { daily: Summary["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.requests))
  const width = 600
  const height = 120
  const bar = width / daily.length
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-32 w-full"
      role="img"
      aria-label={`Requests per day, highest ${max}`}
    >
      {daily.map((d, i) => {
        const h = (d.requests / max) * (height - 4)
        return (
          <rect
            key={d.date}
            x={i * bar + bar * 0.15}
            y={height - h}
            width={bar * 0.7}
            height={h}
            rx={2}
            className="fill-violet-400/80"
          >
            <title>{`${d.date}: ${d.requests}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function HealthBanner({ health }: { health: Summary["health"] }) {
  const tone = health.urgent
    ? "border-red-500/50 bg-red-950/40 text-red-200"
    : health.ok
      ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-200"
      : "border-amber-500/40 bg-amber-950/30 text-amber-200"
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>
      {health.ok
        ? "Analytics health: all checks pass."
        : `${health.urgent ? "Urgent: " : ""}Analytics health problems: ${health.problems.join(", ")}. ` +
          "See docs/analytics-operations.md."}
    </div>
  )
}

function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-200">
      <div className="flex items-center gap-5">
        <h1 className="border-r border-neutral-700 pr-5 text-2xl font-medium">404</h1>
        <p className="text-sm">This page could not be found.</p>
      </div>
    </main>
  )
}

export function AdminDashboard() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7)
  const [state, setState] = useState<State>({ status: "loading" })

  useEffect(() => {
    let live = true
    setState({ status: "loading" })
    withAuthRedirect(() => authGet<Summary>(`${API_BASE_URL}/api/admin/analytics/summary?days=${days}`))
      .then((data) => live && setState({ status: "ready", data }))
      .catch((error) => {
        if (!live) return
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        if (status === 403) return setState({ status: "not-found" })
        const detail = axios.isAxiosError(error) ? error.response?.data?.detail : undefined
        setState({ status: "error", message: typeof detail === "string" ? detail : "Couldn't load analytics." })
      })
    return () => {
      live = false
    }
  }, [days])

  if (state.status === "not-found") return <NotFound />

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-200 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">Analytics</h1>
            <p className="text-sm text-neutral-400">
              Counts of people include consenting users only. Small groups are hidden.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-neutral-800 p-1" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                onClick={() => setDays(p)}
                className={`rounded-md px-3 py-1 text-sm ${
                  days === p ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {p} days
              </button>
            ))}
          </div>
        </header>

        {state.status === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-red-300">
            {state.message}
          </p>
        )}
        {state.status === "ready" && <Report data={state.data} />}
      </div>
    </main>
  )
}

function Report({ data }: { data: Summary }) {
  const { research, followups, blocked, retention, product, feedback } = data
  const failures = Object.entries(data.failures_by_stage).flatMap(([kind, stages]) =>
    Object.entries(stages).map(([stage, n]) => `${kind} ${stage}: ${n}`)
  )
  return (
    <>
      <HealthBanner health={data.health} />
      {data.truncated && (
        <p className="text-sm text-amber-300">Too many rows to read in full; these figures are partial.</p>
      )}

      <Section title="System totals">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Research requests" value={String(research.total_requests)} />
          <Stat
            label="Research completion"
            value={research.completion_rate === null ? "–" : percent(research.completion_rate)}
          />
          <Stat label="Follow-ups" value={String(followups.total_requests)} />
          <Stat label="Failed (research + follow-up)" value={String(research.failed_requests + followups.failed_requests)} />
          <Stat label="Blocked requests" value={String(blocked.total)} />
          <Stat label="Estimated cost" value={`$${data.total_estimated_cost_usd.toFixed(2)}`} />
          <Stat label="Median latency" value={seconds(research.latency_ms.median)} />
          <Stat label="Median time to first token" value={seconds(research.ttft_ms.median)} />
        </div>
        {(failures.length > 0 || blocked.total > 0) && (
          <p className="mt-4 text-xs text-neutral-400">
            {[...failures, ...Object.entries(blocked.by_reason).filter(([, n]) => n).map(([r, n]) => `blocked ${r}: ${n}`)].join(" · ")}
          </p>
        )}
      </Section>

      <Section title="Requests per day">
        <DailyBars daily={data.daily} />
      </Section>

      <Section title="Consenting users">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Active in period" value={cellText(data.consenting_users.active)} />
          <Stat label="New in period" value={cellText(retention.new_users)} />
          {(["d1", "d7", "d30"] as const).map((k) => (
            <Stat key={k} label={`Back within ${k.slice(1)} days`} value={cellText(retention[k].rate, percent)} />
          ))}
        </div>
      </Section>

      <Section title="Feature use (consenting users)">
        <p className="mb-3 text-xs text-neutral-400">
          {cellText(product.total_events)} events from {cellText(product.contributors)} people
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-400">
              <th className="py-1 font-normal">Event</th>
              <th className="py-1 font-normal">Events</th>
              <th className="py-1 font-normal">People</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(product.by_event).map(([name, v]) => (
              <tr key={name} className="border-t border-neutral-800">
                <td className="py-1.5 font-mono text-xs">{name}</td>
                <td className="py-1.5">{cellText(v.events)}</td>
                <td className="py-1.5">{cellText(v.contributors)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {feedback && (
        <Section title="Answer feedback">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Ratings" value={cellText(feedback.ratings)} />
            <Stat label="Thumbs up" value={cellText(feedback.up_rate, percent)} />
          </div>
        </Section>
      )}
    </>
  )
}
