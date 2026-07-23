"""FastALPR integration using container-baked ONNX artifacts."""

from __future__ import annotations

import os
import statistics
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fast_alpr import ALPR
from fast_alpr.base import BaseDetector, DetectionResult
from fast_alpr.default_ocr import DefaultOCR
from gatesight_domain.models import PlateCandidate
from gatesight_domain.normalization import normalize_plate
from numpy.typing import NDArray
from open_image_models.detection.core.yolo_v9.inference import YoloV9ObjectDetector

from gatesight_recognition_worker.quality import (
    CropVariants,
    frame_quality,
    rectify_and_enhance,
)

DETECTOR_NAME = "yolo-v9-s-608-license-plate-end2end"
OCR_NAME = "cct-s-v2-global-model"
MODEL_VERSION = "fast-alpr-0.4.0/fast-plate-ocr-1.1.0"


class BakedDetector(BaseDetector):  # type: ignore[misc]
    def __init__(self, model_path: Path, confidence: float) -> None:
        self.detector = YoloV9ObjectDetector(
            model_path=model_path,
            class_labels=["License Plate"],
            conf_thresh=confidence,
            providers=["CPUExecutionProvider"],
            sess_options=_session_options(),
        )

    def predict(self, frame: NDArray[np.uint8]) -> list[DetectionResult]:
        value = self.detector.predict(frame)
        return value


def _session_options() -> ort.SessionOptions:
    options = ort.SessionOptions()
    options.intra_op_num_threads = int(os.getenv("GATESIGHT_ONNX_THREADS", "2"))
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return options


@dataclass(frozen=True, slots=True)
class InferenceOutput:
    candidates: list[PlateCandidate]
    crop_variants: list[tuple[int, CropVariants]]
    maximum_plate_count: int


class RecognitionEngine:
    def __init__(self, model_directory: Path, detector_confidence: float) -> None:
        detector_path = model_directory / "yolo-v9-s-608-license-plates-end2end.onnx"
        ocr_path = model_directory / "cct_s_v2_global.onnx"
        config_path = model_directory / "cct_s_v2_global_plate_config.yaml"
        missing = [path for path in (detector_path, ocr_path, config_path) if not path.is_file()]
        if missing:
            raise FileNotFoundError(f"container-baked model artifacts are missing: {missing}")
        detector = BakedDetector(detector_path, detector_confidence)
        ocr = DefaultOCR(
            hub_ocr_model=None,
            device="cpu",
            providers=["CPUExecutionProvider"],
            sess_options=_session_options(),
            model_path=ocr_path,
            config_path=config_path,
        )
        self.alpr = ALPR(detector=detector, ocr=ocr)

    def infer(self, frames: list[NDArray[np.uint8]]) -> InferenceOutput:
        candidates: list[PlateCandidate] = []
        crop_variants: list[tuple[int, CropVariants]] = []
        maximum_plate_count = 0
        for frame_index, frame in enumerate(frames):
            results = self.alpr.predict(frame)
            maximum_plate_count = max(maximum_plate_count, len(results))
            for result_index, result in enumerate(results):
                box = result.detection.bounding_box
                x1, y1 = max(box.x1, 0), max(box.y1, 0)
                x2, y2 = min(box.x2, frame.shape[1]), min(box.y2, frame.shape[0])
                variants = rectify_and_enhance(frame[y1:y2, x1:x2])
                ocr_result = self.alpr.ocr.predict(variants.enhanced)
                raw_text = ocr_result.text if ocr_result else ""
                confidence_values = ocr_result.confidence if ocr_result else 0.0
                if isinstance(confidence_values, list):
                    char_confidences = confidence_values
                    ocr_confidence = (
                        float(statistics.mean(confidence_values)) if confidence_values else 0.0
                    )
                else:
                    char_confidences = []
                    ocr_confidence = float(confidence_values)
                quality = frame_quality(variants.original, plate_pixel_width=max(0, x2 - x1))
                candidates.append(
                    PlateCandidate(
                        frame_index=frame_index,
                        raw_text=raw_text,
                        normalized_text=normalize_plate(raw_text),
                        detector_confidence=float(result.detection.confidence),
                        ocr_confidence=ocr_confidence,
                        character_confidences=char_confidences,
                        region=ocr_result.region if ocr_result else None,
                        region_confidence=ocr_result.region_confidence if ocr_result else None,
                        quality=quality,
                        bounding_box=(x1, y1, x2, y2),
                    )
                )
                crop_variants.append((result_index, variants))
        return InferenceOutput(candidates, crop_variants, maximum_plate_count)
