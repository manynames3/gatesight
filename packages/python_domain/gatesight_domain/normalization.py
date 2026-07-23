"""Plate normalization without speculative character correction."""

from __future__ import annotations

import re

_NON_ALPHANUMERIC = re.compile(r"[^A-Z0-9]")


def normalize_plate(raw: str) -> str | None:
    """Uppercase and remove separators; never substitute a character."""
    normalized = _NON_ALPHANUMERIC.sub("", raw.upper())
    if not 1 <= len(normalized) <= 12:
        return None
    return normalized


def mask_plate(normalized: str) -> str:
    """Return a notification-safe plate representation."""
    if len(normalized) <= 2:
        return "•" * len(normalized)
    return f"{normalized[:1]}{'•' * (len(normalized) - 2)}{normalized[-1:]}"
