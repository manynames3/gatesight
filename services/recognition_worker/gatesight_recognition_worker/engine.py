"""FastALPR integration using container-baked ONNX artifacts."""

from __future__ import annotations

import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from fast_alpr.base import BaseDetector, DetectionResult
from fast_alpr.default_ocr import DefaultOCR
from gatesight_domain.models import NormalizedRegion, PlateCandidate
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
    guide_detector_frames: int
    guide_fallback_frames: int
    full_frame_fallback_frames: int


@dataclass(frozen=True, slots=True)
class OcrEvidence:
    raw_text: str
    normalized_text: str | None
    confidence: float
    character_confidences: list[float]
    region: str | None
    region_confidence: float | None


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
        self.detector = detector
        self.ocr = ocr

    def _ocr_evidence(self, image: NDArray[np.uint8]) -> OcrEvidence:
        result: Any = self.ocr.predict(image)
        if result is None:
            return OcrEvidence("", None, 0, [], None, None)
        raw_text = str(result.text or "")
        confidence_values = result.confidence
        if isinstance(confidence_values, list):
            character_confidences = [float(value) for value in confidence_values]
            confidence = (
                float(statistics.mean(character_confidences)) if character_confidences else 0.0
            )
        else:
            character_confidences = []
            confidence = float(confidence_values or 0)
        return OcrEvidence(
            raw_text=raw_text,
            normalized_text=normalize_plate(raw_text),
            confidence=confidence,
            character_confidences=character_confidences,
            region=result.region,
            region_confidence=result.region_confidence,
        )

    def _best_ocr(self, variants: CropVariants) -> OcrEvidence:
        evidence = [
            self._ocr_evidence(variants.original),
            self._ocr_evidence(variants.normalized),
            self._ocr_evidence(variants.enhanced),
        ]
        return max(
            evidence,
            key=lambda item: (item.normalized_text is not None, item.confidence),
        )

    @staticmethod
    def _guide_bounds(
        frame: NDArray[np.uint8],
        region: NormalizedRegion,
        *,
        padding: float,
    ) -> tuple[int, int, int, int]:
        height, width = frame.shape[:2]
        region_x1 = region.x * width
        region_y1 = region.y * height
        region_width = region.width * width
        region_height = region.height * height
        padding_x = region_width * padding
        padding_y = region_height * padding
        return (
            max(0, int(region_x1 - padding_x)),
            max(0, int(region_y1 - padding_y)),
            min(width, int(region_x1 + region_width + padding_x)),
            min(height, int(region_y1 + region_height + padding_y)),
        )

    def _detect(
        self,
        *,
        frame_index: int,
        frame: NDArray[np.uint8],
        bounds: tuple[int, int, int, int],
    ) -> tuple[list[PlateCandidate], list[tuple[int, CropVariants]], int]:
        search_x1, search_y1, search_x2, search_y2 = bounds
        search = frame[search_y1:search_y2, search_x1:search_x2]
        results = self.detector.predict(search)
        candidates: list[PlateCandidate] = []
        crops: list[tuple[int, CropVariants]] = []
        for result_index, result in enumerate(results):
            box = result.bounding_box
            local_x1 = max(int(box.x1), 0)
            local_y1 = max(int(box.y1), 0)
            local_x2 = min(int(box.x2), search.shape[1])
            local_y2 = min(int(box.y2), search.shape[0])
            if local_x2 <= local_x1 or local_y2 <= local_y1:
                continue
            x1, y1 = search_x1 + local_x1, search_y1 + local_y1
            x2, y2 = search_x1 + local_x2, search_y1 + local_y2
            variants = rectify_and_enhance(frame[y1:y2, x1:x2])
            ocr = self._best_ocr(variants)
            candidates.append(
                PlateCandidate(
                    frame_index=frame_index,
                    raw_text=ocr.raw_text,
                    normalized_text=ocr.normalized_text,
                    detector_confidence=float(result.confidence),
                    ocr_confidence=ocr.confidence,
                    character_confidences=ocr.character_confidences,
                    region=ocr.region,
                    region_confidence=ocr.region_confidence,
                    quality=frame_quality(variants.original, plate_pixel_width=x2 - x1),
                    bounding_box=(x1, y1, x2, y2),
                    source="DETECTOR",
                )
            )
            crops.append((result_index, variants))
        return candidates, crops, len(results)

    def _guide_fallback(
        self,
        *,
        frame_index: int,
        frame: NDArray[np.uint8],
        region: NormalizedRegion,
    ) -> tuple[PlateCandidate | None, CropVariants | None]:
        x1, y1, x2, y2 = self._guide_bounds(frame, region, padding=0)
        variants = rectify_and_enhance(frame[y1:y2, x1:x2])
        ocr = self._best_ocr(variants)
        if not ocr.normalized_text:
            return None, None
        return (
            PlateCandidate(
                frame_index=frame_index,
                raw_text=ocr.raw_text,
                normalized_text=ocr.normalized_text,
                detector_confidence=0,
                ocr_confidence=ocr.confidence,
                character_confidences=ocr.character_confidences,
                region=ocr.region,
                region_confidence=ocr.region_confidence,
                quality=frame_quality(variants.original, plate_pixel_width=x2 - x1),
                bounding_box=(x1, y1, x2, y2),
                source="GUIDE_FALLBACK",
            ),
            variants,
        )

    def infer(
        self,
        frames: list[NDArray[np.uint8]],
        guide_region: NormalizedRegion | None = None,
    ) -> InferenceOutput:
        candidates: list[PlateCandidate] = []
        crop_variants: list[tuple[int, CropVariants]] = []
        maximum_plate_count = 0
        guide_detector_frames = 0
        guide_fallback_frames = 0
        full_frame_fallback_frames = 0
        for frame_index, frame in enumerate(frames):
            height, width = frame.shape[:2]
            frame_candidates: list[PlateCandidate] = []
            frame_crops: list[tuple[int, CropVariants]] = []
            frame_plate_count = 0
            if guide_region is not None:
                frame_candidates, frame_crops, frame_plate_count = self._detect(
                    frame_index=frame_index,
                    frame=frame,
                    bounds=self._guide_bounds(frame, guide_region, padding=0.15),
                )
                if frame_candidates:
                    guide_detector_frames += 1
            if not frame_candidates:
                frame_candidates, frame_crops, frame_plate_count = self._detect(
                    frame_index=frame_index,
                    frame=frame,
                    bounds=(0, 0, width, height),
                )
                if frame_candidates and guide_region is not None:
                    full_frame_fallback_frames += 1
            if not frame_candidates and guide_region is not None:
                fallback, variants = self._guide_fallback(
                    frame_index=frame_index,
                    frame=frame,
                    region=guide_region,
                )
                if fallback is not None and variants is not None:
                    frame_candidates = [fallback]
                    frame_crops = [(0, variants)]
                    frame_plate_count = 1
                    guide_fallback_frames += 1
            candidates.extend(frame_candidates)
            crop_variants.extend(frame_crops)
            maximum_plate_count = max(maximum_plate_count, frame_plate_count)
        return InferenceOutput(
            candidates,
            crop_variants,
            maximum_plate_count,
            guide_detector_frames,
            guide_fallback_frames,
            full_frame_fallback_frames,
        )
