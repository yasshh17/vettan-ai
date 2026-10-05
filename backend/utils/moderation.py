"""
Content moderation for research queries, generated answers and text sent to TTS.

Uses OpenAI's moderation endpoint, which is free. Fails open by default: the same
provider runs synthesis, so failing closed would only add a second way to go down.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Literal, Union

from fastapi import HTTPException

from utils.rate_limit import _env_bool, _env_float

logger = logging.getLogger(__name__)


# check() reads these at call time so tests can override them.
ENABLED: bool = _env_bool("MODERATION_ENABLED", True)
TIMEOUT_S: float = _env_float("MODERATION_TIMEOUT_S", 3.0)
FAIL_CLOSED: bool = _env_bool("MODERATION_FAIL_CLOSED", False)

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
    try:
        raw = await asyncio.wait_for(_moderate(text), timeout=TIMEOUT_S)
    except Exception as e:
        if FAIL_CLOSED:
            logger.error("Moderation unavailable, refusing %s (failing closed): %r", source, e)
            return Verdict(True, unavailable=True)
        logger.warning("Moderation unavailable, allowing %s (failing open): %r", source, e)
        return CLEAN
    logger.info(f"[Moderation] {source} {time.perf_counter() - started:.2f}s")

    hits = _hits(raw, QUESTION_LIMITS if source == "input" else GENERATED_LIMITS)
    # Categories only: the text itself stays out of the logs.
    if not hits:
        if raw.flagged:
            # Kept so the limits can be recalibrated against real traffic.
            logger.info(
                "Moderation allowed %s for user %s despite: %s",
                source, user_id[:8], ", ".join(sorted(raw.flagged)),
            )
        return CLEAN
    logger.warning("Moderation blocked %s for user %s: %s", source, user_id[:8], ", ".join(hits))
    return Verdict(True, hits)


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
