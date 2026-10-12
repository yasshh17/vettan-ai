"""
Records one analytics_events row per research or follow-up request.
Numbers only. Keep query text, answers and URLs out of these.
"""
from __future__ import annotations

import logging
import math
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, Mapping, Optional, Protocol

from utils.rate_limit import _env_bool

logger = logging.getLogger(__name__)


# record() reads this at call time so tests can override it.
ENABLED: bool = _env_bool("ANALYTICS_ENABLED", True)

TABLE = "analytics_events"

# Keep in sync with the CHECKs in 0008_analytics_events.sql.
EVENT_TYPES = frozenset({
    "research_completed",
    "research_failed",
    "cache_hit",
    "followup_completed",
    "followup_failed",
})
REQUEST_TYPES = frozenset({"research", "followup"})
FAILURE_STAGES = frozenset({
    "decomposition",
    "search",
    "search_no_results",
    "synthesis",
    "moderation_output",
    "history",
    "pipeline",           # non-streaming run raised; step unknown
    "client_disconnect",
    "internal",
})

MS_FIELDS = (
    "total_latency_ms",
    "ttft_ms",
    "decomposition_latency_ms",
    "search_latency_ms",
    "synthesis_latency_ms",
)
COUNT_FIELDS = (
    "subquery_count",
    "successful_search_count",
    "total_search_count",
    "selected_source_count",
)

_METADATA_ENUMS: Dict[str, frozenset] = {
    "transport": frozenset({"stream", "sync"}),
    "pipeline": frozenset({"parallel_v2", "stream_v1", "direct_llm", "direct_llm_stream"}),
}
# cost_partial: the request ended early, so the cost is a lower bound.
_METADATA_BOOLS = frozenset({"decomposition_fallback", "cost_partial"})
_METADATA_INTS = frozenset({"synthesis_ttft_ms", "input_tokens", "output_tokens"})

_MAX_PENDING = 256


def _non_negative_int(value: Any) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return int(round(value))


def _cost(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return round(float(value), 6)


def _uuid_or_none(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def _clean_metadata(metadata: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    clean: Dict[str, Any] = {}
    for key, value in (metadata or {}).items():
        if value is None:
            continue
        if key in _METADATA_ENUMS and value in _METADATA_ENUMS[key]:
            clean[key] = value
        elif key in _METADATA_BOOLS and isinstance(value, bool):
            clean[key] = value
        elif key in _METADATA_INTS and _non_negative_int(value) is not None:
            clean[key] = _non_negative_int(value)
        else:
            # Log the key, not the value.
            logger.debug("Analytics metadata %r dropped", str(key)[:40])
    return clean


def build_event(
    event_type: str,
    *,
    user_id: Optional[str],
    session_id: Optional[str] = None,
    failure_stage: Optional[str] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    **metrics: Any,
) -> Dict[str, Any]:
    """Row for analytics_events. Unknown metrics and metadata are dropped."""
    if event_type not in EVENT_TYPES:
        raise ValueError(f"unknown analytics event {event_type!r}")

    success = event_type in ("research_completed", "cache_hit", "followup_completed")
    if success:
        failure_stage = None
    elif failure_stage not in FAILURE_STAGES:
        failure_stage = "internal"

    row: Dict[str, Any] = {
        "user_id": _uuid_or_none(user_id),
        "session_id": _uuid_or_none(session_id),
        "event_type": event_type,
        "request_type": "followup" if event_type.startswith("followup_") else "research",
        "success": success,
        "failure_stage": failure_stage,
        "cache_hit": event_type == "cache_hit",
        "estimated_cost_usd": _cost(metrics.get("estimated_cost_usd")),
        "metadata": _clean_metadata(metadata),
    }
    for field in MS_FIELDS + COUNT_FIELDS:
        row[field] = _non_negative_int(metrics.get(field))
    return row


class AnalyticsStore(Protocol):
    def insert(self, row: Dict[str, Any]) -> None:
        ...


class AnalyticsUnavailable(Exception):
    pass


class SupabaseAnalyticsStore:
    """Service role only; 0008 grants anon and authenticated nothing."""

    def __init__(self, client_factory: Callable[[], Any]) -> None:
        self._client_factory = client_factory

    def insert(self, row: Dict[str, Any]) -> None:
        client = self._client_factory()
        if client is None:
            raise AnalyticsUnavailable("service-role Supabase client is not configured")
        client.table(TABLE).insert(row).execute()


def _admin_client() -> Any:
    from database.supabase_admin_client import get_admin_client

    return get_admin_client()


# Swapped out by tests.
store: AnalyticsStore = SupabaseAnalyticsStore(_admin_client)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="analytics")
_pending = 0
_idle = threading.Condition()
_warned_unavailable = False


def _write(row: Dict[str, Any]) -> None:
    global _pending, _warned_unavailable
    try:
        store.insert(row)
    except AnalyticsUnavailable as e:
        if not _warned_unavailable:
            _warned_unavailable = True
            logger.warning("Analytics is off: %s", e)
    except Exception as e:
        # Type and code only; driver messages can echo the row.
        logger.warning(
            "Analytics event %s not recorded: %s%s",
            row.get("event_type"),
            type(e).__name__,
            f" ({e.code})" if isinstance(getattr(e, "code", None), str) else "",
        )
    finally:
        with _idle:
            _pending -= 1
            _idle.notify_all()


def record(event_type: str, **fields: Any) -> None:
    """Queue an event. Never raises or waits on the database."""
    global _pending
    try:
        if not ENABLED:
            return
        row = build_event(event_type, **fields)
        with _idle:
            if _pending >= _MAX_PENDING:
                logger.warning("Analytics backlog full; %s event dropped", event_type)
                return
            _pending += 1
        try:
            _executor.submit(_write, row)
        except Exception:
            with _idle:
                _pending -= 1
                _idle.notify_all()
            raise
    except Exception as e:
        logger.warning("Analytics event %s not recorded: %s", event_type, type(e).__name__)


def flush(timeout: float = 5.0) -> bool:
    """For tests."""
    with _idle:
        return _idle.wait_for(lambda: _pending == 0, timeout)


_PIPELINE_COLUMNS = (
    "decomposition_latency_ms",
    "search_latency_ms",
    "synthesis_latency_ms",
    "estimated_cost_usd",
) + COUNT_FIELDS
_PIPELINE_METADATA = (
    "pipeline", "decomposition_fallback", "synthesis_ttft_ms", "input_tokens", "output_tokens", "cost_partial",
)


class RequestTracker:
    """
    One outcome per request; the first one recorded wins.

    `stage` stays None until paid work starts, so finish() skips requests a
    guard turned away.
    """

    def __init__(
        self,
        user_id: str,
        request_type: str,
        transport: str,
        started: Optional[float] = None,
    ) -> None:
        self.user_id = user_id
        self.request_type = request_type
        self.transport = transport
        self.started = started if started is not None else time.perf_counter()
        self.stage: Optional[str] = None
        self.ttft_ms: Optional[int] = None
        # Mid-stream analytics, used if the request fails before "final".
        self.progress: Optional[Mapping[str, Any]] = None
        self.recorded = False

    def _elapsed_ms(self) -> int:
        return int(round((time.perf_counter() - self.started) * 1000))

    def update_progress(self, analytics: Optional[Mapping[str, Any]]) -> None:
        if analytics:
            self.progress = analytics

    def mark_first_token(self) -> None:
        if self.ttft_ms is None:
            self.ttft_ms = self._elapsed_ms()

    def _record(
        self,
        event_type: str,
        *,
        session_id: Optional[str] = None,
        failure_stage: Optional[str] = None,
        analytics: Optional[Mapping[str, Any]] = None,
        **metrics: Any,
    ) -> None:
        if self.recorded:
            return
        self.recorded = True
        try:
            run = analytics or {}
            columns = {k: run.get(k) for k in _PIPELINE_COLUMNS}
            columns.update(metrics)
            metadata = {k: run.get(k) for k in _PIPELINE_METADATA}
            metadata["transport"] = self.transport
            record(
                event_type,
                user_id=self.user_id,
                session_id=session_id,
                failure_stage=failure_stage,
                metadata=metadata,
                total_latency_ms=self._elapsed_ms(),
                ttft_ms=self.ttft_ms,
                **columns,
            )
        except Exception as e:
            logger.warning("Analytics event %s not recorded: %s", event_type, type(e).__name__)

    def completed(self, *, session_id: Optional[str] = None, analytics: Optional[Mapping[str, Any]] = None) -> None:
        self._record(f"{self.request_type}_completed", session_id=session_id, analytics=analytics)

    def failed(
        self,
        stage: Optional[str],
        *,
        session_id: Optional[str] = None,
        analytics: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self._record(
            f"{self.request_type}_failed",
            session_id=session_id,
            failure_stage=stage or "internal",
            analytics=analytics or self.progress,
        )

    def outcome(self, analytics: Optional[Mapping[str, Any]], *, session_id: Optional[str] = None) -> None:
        """Completed, unless the pipeline reported a failure_stage."""
        stage = (analytics or {}).get("failure_stage")
        if stage:
            self.failed(stage, session_id=session_id, analytics=analytics)
        else:
            self.completed(session_id=session_id, analytics=analytics)

    def cache_hit(self, *, session_id: Optional[str] = None, selected_source_count: Optional[int] = None) -> None:
        self._record("cache_hit", session_id=session_id, selected_source_count=selected_source_count)

    def finish(self, stage: Optional[str] = None) -> None:
        """For `finally`: records a failure if work started and nothing was recorded."""
        if not self.recorded and self.stage is not None:
            self.failed(stage or self.stage)
