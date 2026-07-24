import runpy
from pathlib import Path

import cv2
import numpy as np


def test_canary_builds_four_full_hd_jpegs_with_a_valid_guide() -> None:
    module = runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "scripts/canary.py"),
    )
    frames, guide = module["_build_frames"]()

    assert len(frames) == 4
    decoded = cv2.imdecode(np.frombuffer(frames[0], dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (1080, 1920, 3)
    assert guide["x"] + guide["width"] <= 1
    assert guide["y"] + guide["height"] <= 1
