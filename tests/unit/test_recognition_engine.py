from types import SimpleNamespace

import numpy as np
from gatesight_domain.models import NormalizedRegion
from gatesight_recognition_worker.engine import RecognitionEngine


class EmptyDetector:
    def __init__(self) -> None:
        self.calls = 0

    def predict(self, frame: np.ndarray) -> list[object]:
        del frame
        self.calls += 1
        return []


class StableOcr:
    def predict(self, frame: np.ndarray) -> SimpleNamespace:
        del frame
        return SimpleNamespace(
            text="ABC123",
            confidence=[0.995] * 6,
            region=None,
            region_confidence=None,
        )


class FullFrameDetector(EmptyDetector):
    def predict(self, frame: np.ndarray) -> list[object]:
        self.calls += 1
        if self.calls == 1:
            return []
        return [
            SimpleNamespace(
                bounding_box=SimpleNamespace(x1=180, y1=190, x2=460, y2=290),
                confidence=0.9,
            )
        ]


def test_guide_crop_becomes_a_conservative_ocr_fallback() -> None:
    detector = EmptyDetector()
    engine = object.__new__(RecognitionEngine)
    engine.detector = detector
    engine.ocr = StableOcr()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    for x in range(180, 460, 24):
        frame[190:290, x : x + 8] = 255

    output = engine.infer(
        [frame],
        NormalizedRegion(x=0.25, y=0.35, width=0.5, height=0.3),
    )

    assert detector.calls == 2
    assert output.guide_detector_frames == 0
    assert output.full_frame_fallback_frames == 0
    assert output.guide_fallback_frames == 1
    assert output.candidates[0].source == "GUIDE_FALLBACK"
    assert output.candidates[0].normalized_text == "ABC123"


def test_full_frame_detector_remains_a_second_path() -> None:
    detector = FullFrameDetector()
    engine = object.__new__(RecognitionEngine)
    engine.detector = detector
    engine.ocr = StableOcr()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[190:290, 180:460] = 255

    output = engine.infer(
        [frame],
        NormalizedRegion(x=0.05, y=0.05, width=0.2, height=0.2),
    )

    assert detector.calls == 2
    assert output.guide_detector_frames == 0
    assert output.full_frame_fallback_frames == 1
    assert output.guide_fallback_frames == 0
    assert output.candidates[0].source == "DETECTOR"
    assert output.candidates[0].bounding_box == (180, 190, 460, 290)
