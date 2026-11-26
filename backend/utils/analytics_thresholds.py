"""
Small-group protection for the admin dashboard. Counts of consenting people
(contributors) and event-only counts below their floor are hidden, and a second
cell is hidden where a total would give the first one away. Floors can be raised
by env but never set below 5. Rules: docs/analytics.md.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Mapping, Optional

MIN_FLOOR = 5
CONTRIBUTORS = "contributors"
EVENTS = "events"


def _floor(env: str) -> int:
    try:
        return max(MIN_FLOOR, int(os.getenv(env, "").strip()))
    except ValueError:
        return MIN_FLOOR


def floors() -> Dict[str, int]:
    return {
        CONTRIBUTORS: _floor("ANALYTICS_MIN_CONTRIBUTORS"),
        EVENTS: _floor("ANALYTICS_MIN_EVENTS"),
    }


def shown(value: Any) -> Dict[str, Any]:
    return {"value": value}


def hidden(kind: str, floor: int) -> Dict[str, Any]:
    return {"value": None, "hidden": kind, "floor": floor}


def cell(count: int, kind: str, floor: int) -> Dict[str, Any]:
    return shown(count) if count >= floor else hidden(kind, floor)


def is_hidden(c: Mapping[str, Any]) -> bool:
    return "hidden" in c


def rate(numerator: Mapping[str, Any], denominator: Mapping[str, Any], value: Optional[float]) -> Dict[str, Any]:
    """A rate gives its parts away, so it's hidden with either of them."""
    for part in (numerator, denominator):
        if is_hidden(part):
            return dict(part)
    return shown(value)


def protect_group(
    counts: Mapping[str, int], kind: str, floor: int, total_shown: bool = True
) -> Dict[str, Dict[str, Any]]:
    """Cells that add up to a shown total. One hidden cell alone could be worked
    out by subtraction, so the next smallest is hidden with it."""
    result = {key: cell(count, kind, floor) for key, count in counts.items()}
    hidden_keys = [key for key, c in result.items() if is_hidden(c)]
    visible = sorted((count, key) for key, count in counts.items() if key not in hidden_keys)
    if total_shown and len(hidden_keys) == 1 and visible:
        result[visible[0][1]] = hidden(kind, floor)
    return result
