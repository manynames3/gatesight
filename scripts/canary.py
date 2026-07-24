"""Exercise capture, recognition, visit projection, and media deletion in AWS."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import cv2
import httpx
import numpy as np
from numpy.typing import NDArray

TERMINAL_STATES = {
    "RECOGNIZED",
    "NEEDS_REVIEW",
    "NO_PLATE",
    "MULTIPLE_PLATES",
    "FAILED",
}
ROOT = Path(__file__).resolve().parents[1]
SOURCE_IMAGE = ROOT / "docs/images/camera-station.webp"


def _build_frames() -> tuple[list[bytes], dict[str, float]]:
    source = cv2.imread(str(SOURCE_IMAGE), cv2.IMREAD_COLOR)
    if source is None:
        raise RuntimeError("canary source image could not be decoded")
    plate = source[485:650, 575:895]
    plate = cv2.resize(plate, (640, 320), interpolation=cv2.INTER_CUBIC)
    canvas_height, canvas_width = 1080, 1920
    x1, y1 = 640, 380
    frames: list[bytes] = []
    for brightness in (0, 2, -2, 1):
        canvas: NDArray[np.uint8] = np.full(
            (canvas_height, canvas_width, 3),
            96,
            dtype=np.uint8,
        )
        adjusted = cv2.convertScaleAbs(plate, alpha=1, beta=brightness)
        canvas[y1 : y1 + 320, x1 : x1 + 640] = adjusted
        ok, encoded = cv2.imencode(
            ".jpg",
            canvas,
            [cv2.IMWRITE_JPEG_QUALITY, 92],
        )
        if not ok:
            raise RuntimeError("canary frame could not be encoded")
        frames.append(encoded.tobytes())
    return frames, {
        "x": x1 / canvas_width,
        "y": y1 / canvas_height,
        "width": 640 / canvas_width,
        "height": 320 / canvas_height,
    }


class Canary:
    def __init__(self, api_url: str, access_token: str, timeout_seconds: int) -> None:
        self.timeout_seconds = timeout_seconds
        self.client = httpx.Client(
            base_url=api_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
            timeout=30,
        )
        self.observation_ids: list[str] = []

    def close(self) -> None:
        self.client.close()

    def _page(self, path: str, facility_id: str) -> list[dict[str, Any]]:
        response = self.client.get(path, params={"facilityId": facility_id, "limit": 100})
        response.raise_for_status()
        return list(response.json()["items"])

    def select_gates(self) -> tuple[str, str, str]:
        response = self.client.get("/v1/facilities")
        response.raise_for_status()
        preferred = os.getenv("GATESIGHT_CANARY_FACILITY_ID")
        facilities = list(response.json()["items"])
        if preferred:
            facilities.sort(key=lambda item: item["recordId"] != preferred)
        for facility in facilities:
            facility_id = str(facility["recordId"])
            stations = self.client.get(f"/v1/facilities/{facility_id}/stations")
            stations.raise_for_status()
            by_direction = {
                str(station["direction"]): str(station["recordId"])
                for station in stations.json()["items"]
            }
            if {"ENTRY", "EXIT"}.issubset(by_direction):
                return facility_id, by_direction["ENTRY"], by_direction["EXIT"]
        raise RuntimeError("canary requires one authorized facility with ENTRY and EXIT stations")

    def capture(
        self,
        *,
        facility_id: str,
        station_id: str,
        frames: list[bytes],
        guide_region: dict[str, float],
    ) -> tuple[str, str]:
        operation = uuid.uuid4().hex
        response = self.client.post(
            "/v1/captures",
            headers={"Idempotency-Key": f"canary-create:{operation}"},
            json={
                "facilityId": facility_id,
                "stationId": station_id,
                "frameCount": len(frames),
                "capturedAtClient": datetime.now(UTC).isoformat(),
                "clientClockOffsetMs": 0,
                "guideRegion": guide_region,
                "synthetic": True,
            },
        )
        response.raise_for_status()
        session = response.json()
        for upload in session["uploads"]:
            frame_index = int(upload["frameIndex"])
            upload_response = httpx.post(
                upload["url"],
                data=upload["fields"],
                files={
                    "file": (
                        f"frame-{frame_index}.jpg",
                        frames[frame_index],
                        "image/jpeg",
                    )
                },
                timeout=30,
            )
            upload_response.raise_for_status()
        completion = self.client.post(
            f"/v1/captures/{session['captureId']}/complete",
            headers={"Idempotency-Key": f"canary-complete:{operation}"},
            json={"uploadedKeys": [upload["key"] for upload in session["uploads"]]},
        )
        completion.raise_for_status()
        capture_id = str(session["captureId"])
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            status_response = self.client.get(f"/v1/captures/{capture_id}")
            status_response.raise_for_status()
            result = status_response.json()
            if result["status"] in TERMINAL_STATES:
                if result["status"] != "RECOGNIZED":
                    raise RuntimeError(
                        f"canary recognition ended in {result['status']} for {capture_id}"
                    )
                observation_id = str(result["observationId"])
                self.observation_ids.append(observation_id)
                return capture_id, observation_id
            time.sleep(2)
        raise TimeoutError(f"canary recognition timed out for {capture_id}")

    def wait_for_open_visit(self, facility_id: str, observation_id: str) -> str:
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            match = next(
                (
                    item
                    for item in self._page("/v1/visits/open", facility_id)
                    if item.get("entryObservationId") == observation_id
                ),
                None,
            )
            if match:
                return str(match["recordId"])
            time.sleep(2)
        raise TimeoutError("canary entry was not projected into an open visit")

    def wait_for_closed_visit(
        self,
        facility_id: str,
        visit_id: str,
        exit_observation_id: str,
    ) -> None:
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            match = next(
                (
                    item
                    for item in self._page("/v1/visits", facility_id)
                    if item.get("recordId") == visit_id
                ),
                None,
            )
            if (
                match
                and match.get("status") == "CLOSED"
                and match.get("exitObservationId") == exit_observation_id
            ):
                return
            time.sleep(2)
        raise TimeoutError("canary exit was not projected into the visit")

    def delete_media(self) -> None:
        for observation_id in self.observation_ids:
            response = self.client.post(f"/v1/observations/{observation_id}/delete-media")
            response.raise_for_status()


def main() -> None:
    api_url = os.environ["GATESIGHT_API_URL"]
    access_token = os.environ["GATESIGHT_ACCESS_TOKEN"]
    timeout_seconds = int(os.getenv("GATESIGHT_CANARY_TIMEOUT_SECONDS", "180"))
    frames, guide_region = _build_frames()
    canary = Canary(api_url, access_token, timeout_seconds)
    try:
        facility_id, entry_station_id, exit_station_id = canary.select_gates()
        canary.capture(
            facility_id=facility_id,
            station_id=exit_station_id,
            frames=frames,
            guide_region=guide_region,
        )
        _, entry_observation_id = canary.capture(
            facility_id=facility_id,
            station_id=entry_station_id,
            frames=frames,
            guide_region=guide_region,
        )
        visit_id = canary.wait_for_open_visit(facility_id, entry_observation_id)
        _, exit_observation_id = canary.capture(
            facility_id=facility_id,
            station_id=exit_station_id,
            frames=frames,
            guide_region=guide_region,
        )
        canary.wait_for_closed_visit(facility_id, visit_id, exit_observation_id)
        print("GateSight end-to-end recognition canary passed.")
    finally:
        canary.delete_media()
        canary.close()


if __name__ == "__main__":
    main()
