"""Image validation, quality measurement, and plate-crop normalization."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

import cv2
import numpy as np
from gatesight_domain.models import FrameQuality
from numpy.typing import NDArray

MIN_DIMENSION = 240
MAX_DIMENSION = 8192
MAX_PIXELS = 24_000_000
Image = NDArray[np.uint8]
FloatPoints = NDArray[np.float32]


@dataclass(frozen=True, slots=True)
class CropVariants:
    original: Image
    normalized: Image
    enhanced: Image


def decode_jpeg(payload: bytes, *, maximum_bytes: int) -> Image:
    if not payload or len(payload) > maximum_bytes:
        raise ValueError("image size is outside the accepted range")
    if not payload.startswith(b"\xff\xd8") or not payload.rstrip().endswith(b"\xff\xd9"):
        raise ValueError("image is not a complete JPEG")
    encoded = np.frombuffer(payload, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("JPEG could not be decoded as a color image")
    height, width = image.shape[:2]
    if (
        min(height, width) < MIN_DIMENSION
        or max(height, width) > MAX_DIMENSION
        or height * width > MAX_PIXELS
    ):
        raise ValueError("image dimensions are outside the accepted range")
    return cast(Image, image)


def _perspective_quality(gray: Image) -> float:
    """Estimate planar skew from the strongest four-corner contour."""
    edges = cv2.Canny(gray, 60, 180)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(polygon) != 4 or cv2.contourArea(polygon) < gray.size * 0.05:
            continue
        corners = _order_quad(polygon.reshape(4, 2).astype(np.float32))
        top = float(np.linalg.norm(corners[1] - corners[0]))
        bottom = float(np.linalg.norm(corners[2] - corners[3]))
        left = float(np.linalg.norm(corners[3] - corners[0]))
        right = float(np.linalg.norm(corners[2] - corners[1]))
        horizontal = min(top, bottom) / max(top, bottom, 1.0)
        vertical = min(left, right) / max(left, right, 1.0)
        return float(max(0.0, min(1.0, (horizontal + vertical) / 2)))
    return 0.65


def frame_quality(image: Image, *, plate_pixel_width: int = 0) -> FrameQuality:
    gray = cast(Image, cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    exposure_score = float(np.mean((gray > 25) & (gray < 235)))
    glare_score = float(np.mean(gray >= 248))
    perspective_score = _perspective_quality(gray)
    usable = (
        blur_score >= 35
        and exposure_score >= 0.35
        and glare_score <= 0.25
        and perspective_score >= 0.4
    )
    reasons: list[str] = []
    if blur_score < 35:
        reasons.append("blur")
    if exposure_score < 0.35:
        reasons.append("exposure")
    if glare_score > 0.25:
        reasons.append("glare")
    if perspective_score < 0.4:
        reasons.append("perspective")
    return FrameQuality(
        blur_score=blur_score,
        exposure_score=exposure_score,
        glare_score=glare_score,
        perspective_score=perspective_score,
        plate_pixel_width=plate_pixel_width,
        usable=usable,
        reasons=reasons,
    )


def _order_quad(points: FloatPoints) -> FloatPoints:
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(differences)]
    ordered[3] = points[np.argmax(differences)]
    return ordered


def rectify_and_enhance(crop: Image) -> CropVariants:
    if crop.size == 0:
        raise ValueError("empty plate crop")
    original = crop.copy()
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 180)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    normalized = crop.copy()
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(polygon) != 4 or cv2.contourArea(polygon) < crop.size * 0.01:
            continue
        source = _order_quad(polygon.reshape(4, 2).astype(np.float32))
        width = max(
            float(np.linalg.norm(source[1] - source[0])),
            float(np.linalg.norm(source[2] - source[3])),
        )
        height = max(
            float(np.linalg.norm(source[3] - source[0])),
            float(np.linalg.norm(source[2] - source[1])),
        )
        if width < 32 or height < 12:
            continue
        target = np.array(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
            dtype=np.float32,
        )
        normalized = cast(
            Image,
            cv2.warpPerspective(
                crop,
                cv2.getPerspectiveTransform(source, target),
                (int(width), int(height)),
            ),
        )
        break
    normalized = cast(Image, cv2.resize(normalized, (256, 96), interpolation=cv2.INTER_CUBIC))
    luminance = cv2.cvtColor(normalized, cv2.COLOR_BGR2LAB)
    light, channel_a, channel_b = cv2.split(luminance)
    enhanced_light = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(light)
    enhanced = cast(
        Image,
        cv2.cvtColor(
            cv2.merge((enhanced_light, channel_a, channel_b)),
            cv2.COLOR_LAB2BGR,
        ),
    )
    return CropVariants(original=original, normalized=normalized, enhanced=enhanced)


def jpeg_bytes(image: Image, quality: int = 92) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("failed to encode derived crop")
    return encoded.tobytes()
