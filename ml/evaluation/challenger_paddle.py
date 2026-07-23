"""Optional PP-OCRv6-small challenger; excluded from the production image."""

from __future__ import annotations

from pathlib import Path
from typing import Any


class PaddleV6SmallChallenger:
    def __init__(self) -> None:
        try:
            from paddleocr import PaddleOCR  # noqa: PLC0415
        except ImportError as error:
            raise RuntimeError(
                "Install the separately locked evaluation challenger environment; "
                "PaddlePaddle is intentionally absent from production."
            ) from error
        self.engine: Any = PaddleOCR(
            text_detection_model_name="PP-OCRv6_small_det",
            text_recognition_model_name="PP-OCRv6_small_rec",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def predict(self, image: Path) -> list[dict[str, Any]]:
        return list(self.engine.predict(str(image)))
