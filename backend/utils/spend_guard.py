"""
Per-user and global daily spend limits for paid API calls.

Costs are fixed estimates reserved before the call. The ledger is in Postgres
(migration 0006) so restarts don't reset it. Fails closed if it is unreachable.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional, Protocol, Tuple

from fastapi import HTTPException

from utils import audit
from utils.rate_limit import _env_bool, _env_float

logger = logging.getLogger(__name__)


# charge() reads these at call time so tests can override them.
ENABLED: bool = _env_bool("SPEND_GUARD_ENABLED", True)

USER_DAILY_BUDGET_USD: float = _env_float("USER_DAILY_BUDGET_USD", 1.00)
# Keep below the hard limits set in the provider dashboards.
GLOBAL_DAILY_BUDGET_USD: float = _env_float("GLOBAL_DAILY_BUDGET_USD", 25.00)

# ~4 Tavily credits + 2 LLM calls.
COST_RESEARCH_USD: float = _env_float("COST_RESEARCH_USD", 0.035)
COST_FOLLOWUP_USD: float = _env_float("COST_FOLLOWUP_USD", 0.002)
# tts-1 list price.
COST_AUDIO_PER_1M_CHARS_USD: float = _env_float("COST_AUDIO_PER_1M_CHARS_USD", 15.0)

ALERT_FRACTION: float = 0.8

KINDS = ("research", "followup", "audio")


def to_micros(usd: float) -> int:
    # reserve_spend rejects cost <= 0.
    return max(1, round(usd * 1_000_000))


def cost_usd(kind: str) -> float:
    if kind == "research":
        return COST_RESEARCH_USD
    if kind == "followup":
        return COST_FOLLOWUP_USD
    raise ValueError(f"no flat cost for kind {kind!r}")


def audio_cost_usd(chars: int) -> float:
    return (max(chars, 0) / 1_000_000) * COST_AUDIO_PER_1M_CHARS_USD


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def seconds_until_utc_midnight(now: Optional[datetime] = None) -> int:
    now = now or _utc_now()
    midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    return max(1, int((midnight - now).total_seconds()))


def format_wait(seconds: int) -> str:
    minutes = seconds // 60
    if minutes < 1:
        return "under a minute"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m" if hours else f"{minutes}m"


@dataclass(frozen=True)
class SpendDecision:
    allowed: bool
    reason: Optional[str]  # "user" or "global" when denied
    user_spent_micros: int
    global_spent_micros: int


@dataclass(frozen=True)
class Reservation:
    user_id: str
    kind: str
    cost_micros: int
    units: int


class SpendGuardUnavailable(Exception):
    pass


class SpendStore(Protocol):
    async def reserve(
        self,
        user_id: str,
        kind: str,
        cost_micros: int,
        user_limit_micros: int,
        global_limit_micros: int,
        units: int = 1,
    ) -> SpendDecision:
        ...

    async def refund(self, user_id: str, kind: str, cost_micros: int, units: int = 1) -> None:
        ...


class PostgresSpendStore:
    """Needs the service-role client; the RPCs are granted to service_role only."""

    def __init__(self, client_factory: Callable[[], Any]) -> None:
        self._client_factory = client_factory

    def _client(self) -> Any:
        client = self._client_factory()
        if client is None:
            raise SpendGuardUnavailable("service-role Supabase client is not configured")
        return client

    async def reserve(
        self,
        user_id: str,
        kind: str,
        cost_micros: int,
        user_limit_micros: int,
        global_limit_micros: int,
        units: int = 1,
    ) -> SpendDecision:
        client = self._client()
        params = {
            "p_user": user_id,
            "p_kind": kind,
            "p_cost": cost_micros,
            "p_user_limit": user_limit_micros,
            "p_global_limit": global_limit_micros,
            "p_units": units,
        }
        try:
            response = await asyncio.to_thread(lambda: client.rpc("reserve_spend", params).execute())
        except Exception as e:
            raise SpendGuardUnavailable(f"reserve_spend failed: {e}") from e

        rows = response.data
        row = rows[0] if isinstance(rows, list) and rows else rows
        if not isinstance(row, dict) or "allowed" not in row:
            raise SpendGuardUnavailable(f"reserve_spend returned an unexpected shape: {rows!r}")
        return SpendDecision(
            allowed=bool(row["allowed"]),
            reason=row.get("reason"),
            user_spent_micros=int(row.get("user_spent") or 0),
            global_spent_micros=int(row.get("global_spent") or 0),
        )

    async def refund(self, user_id: str, kind: str, cost_micros: int, units: int = 1) -> None:
        client = self._client()
        params = {"p_user": user_id, "p_kind": kind, "p_cost": cost_micros, "p_units": units}
        try:
            await asyncio.to_thread(lambda: client.rpc("refund_spend", params).execute())
        except Exception as e:
            raise SpendGuardUnavailable(f"refund_spend failed: {e}") from e


class InMemorySpendStore:
    """In-memory equivalent of the SQL functions, for tests."""

    def __init__(self, clock: Callable[[], datetime] = _utc_now) -> None:
        self._clock = clock
        self._users: Dict[Tuple[str, date], int] = {}
        self._global: Dict[date, int] = {}
        self._lock = threading.Lock()

    def user_spent(self, user_id: str) -> int:
        with self._lock:
            return self._users.get((user_id, self._clock().date()), 0)

    def global_spent(self) -> int:
        with self._lock:
            return self._global.get(self._clock().date(), 0)

    async def reserve(
        self,
        user_id: str,
        kind: str,
        cost_micros: int,
        user_limit_micros: int,
        global_limit_micros: int,
        units: int = 1,
    ) -> SpendDecision:
        if cost_micros <= 0:
            raise ValueError("cost_micros must be positive")
        day = self._clock().date()
        with self._lock:
            user = self._users.get((user_id, day), 0)
            total = self._global.get(day, 0)
            if user + cost_micros > user_limit_micros:
                return SpendDecision(False, "user", user, total)
            if total + cost_micros > global_limit_micros:
                return SpendDecision(False, "global", user, total)
            self._users[(user_id, day)] = user + cost_micros
            self._global[day] = total + cost_micros
            return SpendDecision(True, None, user + cost_micros, total + cost_micros)

    async def refund(self, user_id: str, kind: str, cost_micros: int, units: int = 1) -> None:
        day = self._clock().date()
        with self._lock:
            if (user_id, day) in self._users:
                self._users[(user_id, day)] = max(0, self._users[(user_id, day)] - cost_micros)
            if day in self._global:
                self._global[day] = max(0, self._global[day] - cost_micros)


_NOUN = {"research": "Research", "followup": "Research", "audio": "Audio"}

# Distinguishes spend-guard 503s from other 503s. Must be listed in CORS expose_headers.
MARKER_HEADER = "X-Spend-Limit"

_alert_lock = threading.Lock()
_alerted_day: Optional[date] = None


def _maybe_alert(global_spent_micros: int) -> None:
    global _alerted_day
    threshold = to_micros(GLOBAL_DAILY_BUDGET_USD) * ALERT_FRACTION
    if global_spent_micros < threshold:
        return
    today = _utc_now().date()
    with _alert_lock:
        if _alerted_day == today:
            return
        _alerted_day = today
    audit.record(
        "spend_alert",
        global_spent_usd=round(global_spent_micros / 1_000_000, 4),
        budget_usd=GLOBAL_DAILY_BUDGET_USD,
    )
    logger.error(
        "Global spend at $%.2f of the $%.2f daily budget (%.0f%%). Research pauses for "
        "everyone when it is reached. Raise GLOBAL_DAILY_BUDGET_USD if this is real traffic.",
        global_spent_micros / 1_000_000,
        GLOBAL_DAILY_BUDGET_USD,
        100 * global_spent_micros / to_micros(GLOBAL_DAILY_BUDGET_USD),
    )


async def charge(
    store: SpendStore,
    user_id: str,
    kind: str,
    usd: float,
    units: int = 1,
) -> Optional[Reservation]:
    """Reserve today's budget for a paid call. Raises 429 (user limit) or 503 (global limit, ledger down)."""
    if not ENABLED:
        return None
    if kind not in KINDS:
        raise ValueError(f"unknown spend kind {kind!r}")

    cost = to_micros(usd)
    try:
        decision = await store.reserve(
            user_id,
            kind,
            cost,
            to_micros(USER_DAILY_BUDGET_USD),
            to_micros(GLOBAL_DAILY_BUDGET_USD),
            units,
        )
    except SpendGuardUnavailable as e:
        logger.error("Spend guard unavailable, refusing paid request (failing closed): %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"{_NOUN[kind]} is temporarily unavailable. Please try again in a few minutes.",
            headers={MARKER_HEADER: "unavailable"},
        )

    _maybe_alert(decision.global_spent_micros)

    if decision.allowed:
        return Reservation(user_id=user_id, kind=kind, cost_micros=cost, units=units)

    audit.record("spend_cap_hit", user_id=user_id, kind=kind, scope=decision.reason or "global")
    wait = seconds_until_utc_midnight()
    headers = {"Retry-After": str(wait), MARKER_HEADER: decision.reason or "global"}
    if decision.reason == "user":
        raise HTTPException(
            status_code=429,
            detail=f"You've reached today's usage limit. It resets in {format_wait(wait)}.",
            headers=headers,
        )
    logger.error("Global daily budget reached — refusing %s for every user until midnight UTC", kind)
    raise HTTPException(
        status_code=503,
        detail="Vettan has reached its capacity for today. Please try again later.",
        headers=headers,
    )


async def refund(store: SpendStore, reservation: Optional[Reservation]) -> None:
    # Best effort: a failed refund only overcharges the user.
    if reservation is None:
        return
    try:
        await store.refund(
            reservation.user_id, reservation.kind, reservation.cost_micros, reservation.units
        )
    except Exception as e:
        logger.warning("Spend refund failed for user %s: %s", reservation.user_id[:8], e)
