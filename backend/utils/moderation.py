"""
Content moderation for research queries, generated answers and text sent to TTS.

Uses OpenAI's moderation endpoint, which is free. If the check can't run, questions
and audio are refused (nothing paid has happened yet, so the cost is one retry) and
answers are let through (they've already streamed, so blocking only loses the save).
A cold connection after a restart once let a threat through, hence the retry and the
warm-up at startup.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Literal, Union

from fastapi import HTTPException

from utils import audit
from utils.rate_limit import _env_bool, _env_float, _env_int

logger = logging.getLogger(__name__)


# check() reads these at call time so tests can override them.
ENABLED: bool = _env_bool("MODERATION_ENABLED", True)
TIMEOUT_S: float = _env_float("MODERATION_TIMEOUT_S", 3.0)
ATTEMPTS: int = max(1, _env_int("MODERATION_ATTEMPTS", 2))
WARM_UP_TIMEOUT_S = 10.0


def _fail_closed_sources(raw: str) -> FrozenSet[str]:
    # "true" = every source, "false" = none, otherwise a comma list.
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return frozenset({"input", "output", "audio"})
    if value in ("0", "false", "no", "off", ""):
        return frozenset()
    return frozenset(s.strip() for s in value.split(",") if s.strip())


FAIL_CLOSED_SOURCES: FrozenSet[str] = _fail_closed_sources(
    os.getenv("MODERATION_FAIL_CLOSED", "input,audio")
)

MODEL = "omni-moderation-latest"

# Marks moderation refusals so the frontend shows them instead of retrying. Must be
# listed in CORS expose_headers. Value: the source, or "unavailable".
MARKER_HEADER = "X-Content-Blocked"

Source = Literal["input", "output", "audio"]

_SELF_HARM = ("self-harm", "self-harm/intent", "self-harm/instructions")

# Per-category limits: FLAG uses OpenAI's own flag, a number blocks at that score or above.
# OpenAI's overall `flagged` is too strict for a research tool. Calibrated on live
# omni-moderation scores (Oct 2026): legitimate questions scored up to 0.84 illicit ("How
# do phishing scams trick people?") and 0.43 violence ("How were people executed in
# medieval Europe?"); requests to cause harm scored 0.94+; a factual answer about the
# Rwandan genocide scored 0.42 violence. Educational self-harm questions aren't flagged.
FLAG = "flag"
QUESTION_LIMITS: Dict[str, Union[str, float]] = {
    "sexual": FLAG,
    "sexual/minors": FLAG,
    "self-harm/intent": FLAG,
    "self-harm/instructions": FLAG,
    "harassment/threatening": FLAG,
    "hate/threatening": FLAG,
    "illicit/violent": 0.5,
    "illicit": 0.9,
    "violence": 0.9,
    "harassment": 0.9,
    "hate": 0.9,
}
# Threats score like violent history on violence alone; the harassment score is what tells them apart.
QUESTION_COMBINED: List[tuple] = [
    (("violence", 0.5), ("harassment", 0.1)),
]
# Answers (and the answers users send to TTS) describe harm when the research is about
# it, and their questions already passed, so only content harmful in any context is withheld.
GENERATED_LIMITS: Dict[str, Union[str, float]] = {
    "sexual/minors": FLAG,
    "self-harm/instructions": FLAG,
    "illicit/violent": 0.5,
}


@dataclass(frozen=True)
class Scores:
    """Raw moderation result: the categories OpenAI flagged, and every category's score."""
    flagged: FrozenSet[str]
    scores: Dict[str, float]


@dataclass(frozen=True)
class Verdict:
    flagged: bool
    # The categories that hit a limit.
    categories: List[str] = field(default_factory=list)
    # Set when failing closed because the check itself could not run.
    unavailable: bool = False


CLEAN = Verdict(False)


async def _moderate(text: str) -> Scores:
    # Imported here so this module loads without an OpenAI key; tests replace this function.
    from agent.research_pipeline import openai_client

    response = await openai_client.moderations.create(model=MODEL, input=text)
    result = response.results[0]
    flagged = frozenset(
        name for name, hit in result.categories.model_dump(by_alias=True).items() if hit
    )
    scores = {
        name: score or 0.0
        for name, score in result.category_scores.model_dump(by_alias=True).items()
    }
    return Scores(flagged, scores)


def _hits(raw: Scores, limits: Dict[str, Union[str, float]]) -> List[str]:
    return sorted(
        name for name, limit in limits.items()
        if (name in raw.flagged if limit == FLAG else raw.scores.get(name, 0.0) >= limit)
    )


async def check(text: str, source: Source, user_id: str = "") -> Verdict:
    """Moderate text. A flagged verdict means don't use it; see blocked() and message()."""
    if not ENABLED or not text.strip():
        return CLEAN

    started = time.perf_counter()
    raw = None
    for attempt in range(ATTEMPTS):
        try:
            raw = await asyncio.wait_for(_moderate(text), timeout=TIMEOUT_S)
            break
        except Exception as e:
            error = e
            if attempt + 1 < ATTEMPTS:
                logger.info("Moderation attempt %d failed for %s, retrying: %r", attempt + 1, source, e)
    if raw is None:
        refuse = source in FAIL_CLOSED_SOURCES
        audit.record(
            "moderation_unavailable",
            user_id=user_id,
            source=source,
            action="refused" if refuse else "allowed",
            error=type(error).__name__,
        )
        return Verdict(True, unavailable=True) if refuse else CLEAN
    logger.info(f"[Moderation] {source} {time.perf_counter() - started:.2f}s")

    hits = _hits(raw, QUESTION_LIMITS if source == "input" else GENERATED_LIMITS)
    if source == "input":
        for pair in QUESTION_COMBINED:
            if all(raw.scores.get(name, 0.0) >= limit for name, limit in pair):
                hits = sorted(set(hits) | {name for name, _ in pair})
    # Categories only: the text itself stays out of the logs.
    if not hits:
        if raw.flagged:
            # Kept so the limits can be recalibrated against real traffic.
            logger.info(
                "Moderation allowed %s for user %s despite: %s",
                source, user_id[:8], ", ".join(sorted(raw.flagged)),
            )
        return CLEAN
    audit.record("moderation_blocked", user_id=user_id, source=source, categories=hits)
    return Verdict(True, hits)


async def warm_up() -> None:
    """Open the connection before the first real check. Never raises."""
    if not ENABLED:
        return
    started = time.perf_counter()
    try:
        await asyncio.wait_for(_moderate("ok"), timeout=WARM_UP_TIMEOUT_S)
        logger.info("[Moderation] warmed in %.2fs", time.perf_counter() - started)
    except Exception as e:
        logger.warning("[Moderation] warm-up failed: %r", e)


def message(source: Source, verdict: Verdict) -> str:
    """User-facing reason for a flagged verdict. Safe to show as-is."""
    if verdict.unavailable:
        noun = "Audio" if source == "audio" else "Research"
        return f"{noun} is temporarily unavailable. Please try again in a few minutes."
    if source == "input" and any(c in _SELF_HARM for c in verdict.categories):
        return (
            "It sounds like you may be going through something difficult. Vettan can't help "
            "with this, but you don't have to face it alone. If you're in immediate danger, call "
            "your local emergency number, or find a free, confidential helpline at findahelpline.com."
        )
    if source == "output":
        return (
            "This answer was withheld because it may violate our usage policy. "
            "Try rephrasing your question."
        )
    if source == "audio":
        return "This text can't be read aloud because it may violate our usage policy."
    return "This request can't be processed because it may violate our usage policy. Try rephrasing it."


def blocked(source: Source, verdict: Verdict) -> HTTPException:
    """400 for flagged content, 503 when failing closed."""
    return HTTPException(
        status_code=503 if verdict.unavailable else 400,
        detail=message(source, verdict),
        headers={MARKER_HEADER: "unavailable" if verdict.unavailable else source},
    )
