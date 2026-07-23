from __future__ import annotations

import json
import runpy
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest

require_release_scope = cast(
    Callable[[dict[str, Any], str], None],
    runpy.run_path("ml/download_models.py")["require_release_scope"],
)


def manifest() -> dict[str, Any]:
    return json.loads(Path("ml/model-manifest.json").read_text())


def test_manifest_permits_noncommercial_portfolio_deployment() -> None:
    require_release_scope(manifest(), "portfolio")


def test_manifest_blocks_commercial_redistribution() -> None:
    with pytest.raises(ValueError, match="redistribution approval is required"):
        require_release_scope(manifest(), "commercial")


def test_unknown_release_scope_is_rejected() -> None:
    with pytest.raises(ValueError, match="unsupported model release scope"):
        require_release_scope(manifest(), "unknown")
