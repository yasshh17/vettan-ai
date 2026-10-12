"""
Aggregates for GET /api/admin/analytics/summary. Never return rows or user ids.
Metric definitions are in docs/analytics.md.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from utils.analytics import TABLE

COLUMNS = (
    "id,created_at,user_id,event_type,request_type,failure_stage,"
    "total_latency_ms,ttft_ms,search_latency_ms,subquery_count,"
    "successful_search_count,total_search_count,selected_source_count,estimated_cost_usd"
)
PAGE_SIZE = 1000
MAX_ROWS = 200_000


def window_start(days: int, now: datetime) -> datetime:
    """Midnight UTC, `days - 1` days ago. Today counts as a day."""
    first_day = now.astimezone(timezone.utc).date() - timedelta(days=days - 1)
    return datetime.combine(first_day, time.min, tzinfo=timezone.utc)


def fetch_rows(client: Any, since: datetime) -> Tuple[List[Dict[str, Any]], bool]:
    """Rows since `since`, paged by id. True if MAX_ROWS cut it short."""
    rows: List[Dict[str, Any]] = []
    while len(rows) < MAX_ROWS:
        # Offset by rows received, in case PostgREST caps a page below PAGE_SIZE.
        response = (
            client.table(TABLE)
            .select(COLUMNS)
            .gte("created_at", since.isoformat())
            .order("id")
            .range(len(rows), len(rows) + PAGE_SIZE - 1)
            .execute()
        )
        batch = response.data or []
        if not batch:
            return rows, False
        rows.extend(batch)
    return rows[:MAX_ROWS], True


def _number(value: Any) -> Optional[float]:
    # numeric columns can arrive as strings from PostgREST.
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _values(rows: Iterable[Dict[str, Any]], field: str) -> List[float]:
    return [v for v in (_number(r.get(field)) for r in rows) if v is not None]


def percentile(values: Sequence[float], p: float) -> Optional[float]:
    """Same interpolation as Postgres percentile_cont."""
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def _distribution(values: Sequence[float]) -> Dict[str, Any]:
    median, p95 = percentile(values, 0.5), percentile(values, 0.95)
    return {
        "median": None if median is None else round(median, 1),
        "p95": None if p95 is None else round(p95, 1),
        "samples": len(values),
    }


def _rate(numerator: int, denominator: int) -> Optional[float]:
    return round(numerator / denominator, 4) if denominator else None


def _mean(values: Sequence[float], digits: int = 2) -> Optional[float]:
    return round(sum(values) / len(values), digits) if values else None


def _day(value: Any) -> Optional[date]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).date()


def summarize(
    rows: Sequence[Dict[str, Any]],
    days: int,
    now: datetime,
    truncated: bool = False,
) -> Dict[str, Any]:
    since = window_start(days, now)
    by_type: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_type[row.get("event_type")].append(row)

    fresh_ok = by_type["research_completed"]
    fresh_failed = by_type["research_failed"]
    cache_hits = by_type["cache_hit"]
    pipeline_runs = fresh_ok + fresh_failed
    research_total = len(pipeline_runs) + len(cache_hits)

    searched = [r for r in pipeline_runs if (_number(r.get("total_search_count")) or 0) > 0]
    partial = [
        r for r in searched
        if 0 < (_number(r.get("successful_search_count")) or 0) < (_number(r.get("total_search_count")) or 0)
    ]
    completed_costs = _values(fresh_ok, "estimated_cost_usd")

    followup_ok = by_type["followup_completed"]
    followup_failed = by_type["followup_failed"]

    failures: Dict[str, Counter] = {"research": Counter(), "followup": Counter()}
    for row in fresh_failed + followup_failed:
        failures[row.get("request_type") or "research"][row.get("failure_stage") or "internal"] += 1

    requests_per_day: Counter = Counter()
    users_per_day: Dict[date, set] = defaultdict(set)
    for row in rows:
        day = _day(row.get("created_at"))
        if day is None:
            continue
        requests_per_day[day] += 1
        if row.get("user_id"):
            users_per_day[day].add(row["user_id"])
    first_day = since.date()

    return {
        "period_days": days,
        "from": since.isoformat(),
        "to": now.astimezone(timezone.utc).isoformat(),
        "truncated": truncated,
        "research": {
            "total_requests": research_total,
            "completed_requests": len(fresh_ok) + len(cache_hits),
            "failed_requests": len(fresh_failed),
            "cache_hits": len(cache_hits),
            "completion_rate": _rate(len(fresh_ok) + len(cache_hits), research_total),
            "pipeline_completion_rate": _rate(len(fresh_ok), len(pipeline_runs)),
            "cache_hit_rate": _rate(len(cache_hits), research_total),
            "latency_ms": _distribution(_values(fresh_ok, "total_latency_ms")),
            "ttft_ms": _distribution(_values(fresh_ok, "ttft_ms")),
            "search_latency_ms": _distribution(_values(pipeline_runs, "search_latency_ms")),
            "avg_successful_searches": _mean(_values(fresh_ok, "successful_search_count")),
            "avg_total_searches": _mean(_values(fresh_ok, "total_search_count")),
            "avg_selected_sources": _mean(_values(fresh_ok, "selected_source_count")),
            "avg_subqueries": _mean(_values(fresh_ok, "subquery_count")),
            "partial_search_rate": _rate(len(partial), len(searched)),
            "avg_cost_per_completed_usd": _mean(completed_costs, 6),
            "cost_samples": len(completed_costs),
        },
        "followups": {
            "total_requests": len(followup_ok) + len(followup_failed),
            "completed_requests": len(followup_ok),
            "failed_requests": len(followup_failed),
            "completion_rate": _rate(len(followup_ok), len(followup_ok) + len(followup_failed)),
            "latency_ms": _distribution(_values(followup_ok, "total_latency_ms")),
            "ttft_ms": _distribution(_values(followup_ok, "ttft_ms")),
        },
        "total_estimated_cost_usd": round(sum(_values(rows, "estimated_cost_usd")), 6),
        "failures_by_stage": {kind: dict(counts) for kind, counts in failures.items()},
        "daily": [
            {
                "date": (first_day + timedelta(days=i)).isoformat(),
                "requests": requests_per_day[first_day + timedelta(days=i)],
                "active_users": len(users_per_day[first_day + timedelta(days=i)]),
            }
            for i in range(days)
        ],
    }


def build_summary(client: Any, days: int, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    rows, truncated = fetch_rows(client, window_start(days, now))
    return summarize(rows, days, now, truncated)
