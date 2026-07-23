#!/usr/bin/env python3
"""Calculate comparable ALPR metrics from labeled predictions."""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any


def edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, 1):
        current = [left_index]
        for right_index, right_char in enumerate(right, 1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def metrics(dataset: dict[str, Any], predictions: dict[str, Any]) -> dict[str, Any]:
    labeled = {capture["captureId"]: capture for capture in dataset["captures"]}
    rows = [
        prediction
        for prediction in predictions["predictions"]
        if prediction["captureId"] in labeled
    ]
    with_plate = [row for row in rows if labeled[row["captureId"]]["expectedPlate"]]
    accepted = [row for row in with_plate if row["state"] == "RECOGNIZED"]
    exact = [
        row
        for row in with_plate
        if row.get("predictedPlate") == labeled[row["captureId"]]["expectedPlate"]
    ]
    accepted_exact = [
        row
        for row in accepted
        if row.get("predictedPlate") == labeled[row["captureId"]]["expectedPlate"]
    ]
    total_characters = sum(len(labeled[row["captureId"]]["expectedPlate"]) for row in with_plate)
    character_errors = sum(
        edit_distance(
            row.get("predictedPlate") or "",
            labeled[row["captureId"]]["expectedPlate"],
        )
        for row in with_plate
    )
    actual_detections = sum(bool(labeled[row["captureId"]].get("boundingBoxes")) for row in rows)
    detected = sum(row.get("plateDetected", False) for row in rows)
    true_detections = sum(
        row.get("plateDetected", False) and bool(labeled[row["captureId"]].get("boundingBoxes"))
        for row in rows
    )
    unregistered_alerts = [row for row in rows if row.get("alertCreated")]
    false_alerts = [
        row for row in unregistered_alerts if row.get("registered") or row["state"] != "RECOGNIZED"
    ]
    latencies = sorted(float(row["latencyMs"]) for row in rows if "latencyMs" in row)
    p95_index = max(0, int(len(latencies) * 0.95) - 1)
    return {
        "dataset": {"name": dataset["name"], "version": dataset["version"], "captures": len(rows)},
        "engine": predictions["engine"],
        "detectorPrecision": true_detections / detected if detected else 0,
        "detectorRecall": true_detections / actual_detections if actual_detections else 0,
        "detectorMap": predictions.get("detectorMap"),
        "ocrExactMatchAccuracy": len(exact) / len(with_plate) if with_plate else 0,
        "characterErrorRate": character_errors / total_characters if total_characters else 0,
        "endToEndExactMatchAccuracy": len(exact) / len(rows) if rows else 0,
        "acceptedResultCoverage": len(accepted) / len(rows) if rows else 0,
        "accuracyAmongAccepted": len(accepted_exact) / len(accepted) if accepted else 0,
        "falseUnregisteredAlertRate": len(false_alerts) / len(rows) if rows else 0,
        "needsReviewRate": sum(row["state"] == "NEEDS_REVIEW" for row in rows) / len(rows)
        if rows
        else 0,
        "latencyMs": {
            "mean": statistics.fmean(latencies) if latencies else None,
            "p95": latencies[p95_index] if latencies else None,
        },
        "coldStartDurationMs": predictions.get("coldStartDurationMs"),
        "containerImageBytes": predictions.get("containerImageBytes"),
    }


def markdown(report: dict[str, Any]) -> str:
    percentage = lambda value: f"{value * 100:.2f}%"  # noqa: E731
    return "\n".join(
        [
            f"# Model evaluation: {report['engine']}",
            "",
            f"Dataset: `{report['dataset']['name']}` version `{report['dataset']['version']}` "
            f"({report['dataset']['captures']} captures).",
            "",
            "| Metric | Measured result |",
            "|---|---:|",
            f"| Detector precision | {percentage(report['detectorPrecision'])} |",
            f"| Detector recall | {percentage(report['detectorRecall'])} |",
            f"| OCR exact match | {percentage(report['ocrExactMatchAccuracy'])} |",
            f"| Character error rate | {percentage(report['characterErrorRate'])} |",
            f"| End-to-end exact match | {percentage(report['endToEndExactMatchAccuracy'])} |",
            f"| Accepted coverage | {percentage(report['acceptedResultCoverage'])} |",
            f"| Accuracy among accepted | {percentage(report['accuracyAmongAccepted'])} |",
            "| False unregistered-alert rate | "
            f"{percentage(report['falseUnregisteredAlertRate'])} |",
            f"| Needs-review rate | {percentage(report['needsReviewRate'])} |",
            "",
            "These are measured results for this manifest, not universal accuracy claims.",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    report = metrics(
        json.loads(arguments.dataset.read_text()),
        json.loads(arguments.predictions.read_text()),
    )
    arguments.output.mkdir(parents=True, exist_ok=True)
    (arguments.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    (arguments.output / "report.md").write_text(markdown(report) + "\n")


if __name__ == "__main__":
    main()
