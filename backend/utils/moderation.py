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
from typing import List, Literal

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


@dataclass(frozen=True)
class Verdict:
    flagged: bool
    categories: List[str] = field(default_factory=list)
    # Set when failing closed because the check itself could not run.
    unavailable: bool = False


CLEAN = Verdict(False)


async def _moderate(text: str) -> Verdict:
    # Imported here so this module loads without an OpenAI key; tests replace this function.
    from agent.research_pipeline import openai_client

    response = await openai_client.moderations.create(model=MODEL, input=text)
    result = response.results[0]
    categories = sorted(
        name for name, hit in result.categories.model_dump(by_alias=True).items() if hit
    )
    return Verdict(bool(result.flagged), categories)


async def check(text: str, source: Source, user_id: str = "") -> Verdict:
    """Moderate text. A flagged verdict means don't use it; see blocked() and message()."""
    if not ENABLED or not text.strip():
        return CLEAN

    started = time.perf_counter()
    try:
        verdict = await asyncio.wait_for(_moderate(text), timeout=TIMEOUT_S)
    except Exception as e:
        if FAIL_CLOSED:
            logger.error("Moderation unavailable, refusing %s (failing closed): %r", source, e)
            return Verdict(True, unavailable=True)
        logger.warning("Moderation unavailable, allowing %s (failing open): %r", source, e)
        return CLEAN
    logger.info(f"[Moderation] {source} {time.perf_counter() - started:.2f}s")

    if verdict.flagged:
        # Categories only: the text itself stays out of the logs.
        logger.warning(
            "Moderation blocked %s for user %s: %s",
            source, user_id[:8], ", ".join(verdict.categories) or "unspecified",
        )
    return verdict


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
