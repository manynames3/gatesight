import cv2
import numpy as np
import pytest
from gatesight_recognition_worker.quality import decode_jpeg, frame_quality


def jpeg(width: int = 640, height: int = 480) -> bytes:
    image = np.full((height, width, 3), 128, dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def test_valid_jpeg_is_decoded_from_memory() -> None:
    assert decode_jpeg(jpeg(), maximum_bytes=1_000_000).shape == (480, 640, 3)


def test_invalid_file_type_is_rejected() -> None:
    with pytest.raises(ValueError, match="complete JPEG"):
        decode_jpeg(b"not-an-image", maximum_bytes=1_000_000)


def test_oversized_file_is_rejected_before_decode() -> None:
    with pytest.raises(ValueError, match="size"):
        decode_jpeg(jpeg(), maximum_bytes=10)


def test_decompression_bomb_dimensions_are_rejected() -> None:
    with pytest.raises(ValueError, match="dimensions"):
        decode_jpeg(jpeg(9000, 300), maximum_bytes=20_000_000)


def test_flat_frame_reports_low_blur() -> None:
    image = np.full((480, 640, 3), 127, dtype=np.uint8)
    assert not frame_quality(image).usable
