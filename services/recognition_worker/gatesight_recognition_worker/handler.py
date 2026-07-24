"""SQS batch-size-one Lambda entrypoint."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.batch import (
    BatchProcessor,
    EventType,
    process_partial_response,
)
from aws_lambda_powertools.utilities.data_classes.sqs_event import SQSRecord
from aws_lambda_powertools.utilities.parameters import get_parameter
from gatesight_domain.consensus import ConsensusThresholds, decide_consensus
from gatesight_domain.models import (
    CompletedEventData,
    DomainEvent,
    RecognitionJob,
)

from gatesight_recognition_worker.engine import MODEL_VERSION, RecognitionEngine
from gatesight_recognition_worker.quality import decode_jpeg, jpeg_bytes
from gatesight_recognition_worker.repository import RecognitionRepository

logger = Logger(service="recognition-worker")
tracer = Tracer(service="recognition-worker")
metrics = Metrics(namespace="GateSight", service="recognition-worker")
processor = BatchProcessor(event_type=EventType.SQS)

MODEL_DIRECTORY = Path(os.getenv("GATESIGHT_MODEL_DIRECTORY", "/opt/models"))
MAXIMUM_FRAME_BYTES = int(os.getenv("GATESIGHT_MAX_FRAME_BYTES", "8000000"))
TABLE_PREFIX = os.getenv("GATESIGHT_TABLE_PREFIX", "gatesight-local")
REGION = os.getenv("AWS_REGION", "us-east-1")
CONFIG_PREFIX = os.getenv("GATESIGHT_CONFIG_PREFIX", "")


def _configuration(name: str, fallback: str) -> str:
    if not CONFIG_PREFIX:
        return os.getenv(f"GATESIGHT_{name.upper().replace('-', '_')}", fallback)
    value = get_parameter(f"{CONFIG_PREFIX}/{name}", max_age=300, decrypt=True)
    return str(value) if value is not None else fallback


HIGH_CONFIDENCE = float(_configuration("high-confidence", "0.88"))
REVIEW_CONFIDENCE = float(_configuration("review-confidence", "0.55"))
DETECTOR_CONFIDENCE = float(_configuration("detector-confidence", "0.40"))
MINIMUM_GOOD_FRAMES = int(_configuration("minimum-good-frames", "2"))
MAXIMUM_EDIT_DISTANCE = int(_configuration("maximum-edit-distance", "1"))
MINIMUM_PLATE_PIXELS = int(_configuration("minimum-plate-pixels", "72"))

_engine: RecognitionEngine | None = None
if os.getenv("GATESIGHT_PRELOAD_MODELS") == "1":
    _engine = RecognitionEngine(MODEL_DIRECTORY, DETECTOR_CONFIDENCE)


def engine() -> RecognitionEngine:
    global _engine
    if _engine is None:
        _engine = RecognitionEngine(MODEL_DIRECTORY, DETECTOR_CONFIDENCE)
    return _engine


def observation_id(capture_id: str) -> str:
    return f"obs_{capture_id.removeprefix('cap_')}"


def outbox_id(capture_id: str) -> str:
    return f"out_{capture_id.removeprefix('cap_')}"


def confidence_category(score: float) -> str:
    if score >= HIGH_CONFIDENCE:
        return "HIGH"
    if score >= REVIEW_CONFIDENCE:
        return "MEDIUM"
    if score > 0:
        return "LOW"
    return "NONE"


@tracer.capture_method
def record_handler(record: SQSRecord) -> None:
    started = datetime.now(UTC)
    job = RecognitionJob.model_validate_json(record.body)
    logger.append_keys(
        correlation_id=job.correlation_id,
        capture_id=job.capture_id,
        tenant_id=job.tenant_id,
        facility_id=job.facility_id,
        model_version=MODEL_VERSION,
    )
    repository = RecognitionRepository(region=REGION, table_prefix=TABLE_PREFIX)
    identifier = observation_id(job.capture_id)
    if repository.observation_exists(job.tenant_id, identifier):
        logger.info("duplicate recognition delivery ignored")
        return
    if not repository.claim(job, started):
        if repository.observation_exists(job.tenant_id, identifier):
            return
        raise RuntimeError("capture is not claimable; retry preserves at-least-once processing")
    try:
        frames = [
            decode_jpeg(
                repository.get_bytes(job.s3_bucket, key, MAXIMUM_FRAME_BYTES),
                maximum_bytes=MAXIMUM_FRAME_BYTES,
            )
            for key in job.s3_keys
        ]
        output = engine().infer(frames)
        thresholds = ConsensusThresholds(
            high_confidence=HIGH_CONFIDENCE,
            review_confidence=REVIEW_CONFIDENCE,
            minimum_good_frames=MINIMUM_GOOD_FRAMES,
            maximum_edit_distance=MAXIMUM_EDIT_DISTANCE,
            minimum_plate_pixels=MINIMUM_PLATE_PIXELS,
        )
        consensus = decide_consensus(
            output.candidates,
            thresholds,
            ambiguous_plate_count=output.maximum_plate_count,
        )
        derived_keys: list[str] = []
        for candidate_index, (result_index, variants) in enumerate(output.crop_variants):
            frame_index = output.candidates[candidate_index].frame_index
            for variant_name, image in (
                ("original", variants.original),
                ("normalized", variants.normalized),
                ("enhanced", variants.enhanced),
            ):
                key = (
                    f"{job.tenant_id}/{job.facility_id}/derived/{job.capture_id}/"
                    f"frame-{frame_index}-plate-{result_index}-{variant_name}.jpg"
                )
                repository.put_derived_crop(
                    bucket=job.s3_bucket,
                    key=key,
                    body=jpeg_bytes(image),
                    capture_id=job.capture_id,
                    variant=variant_name,
                )
                derived_keys.append(key)
        completed = datetime.now(UTC)
        event = DomainEvent(
            id=outbox_id(job.capture_id),
            type="com.gatesight.plate-recognition.completed.v1",
            subject=f"observations/{identifier}",
            time=completed,
            correlation_id=job.correlation_id,
            tenant_id=job.tenant_id,
            data=CompletedEventData(
                observation_id=identifier,
                capture_id=job.capture_id,
                facility_id=job.facility_id,
                station_id=job.station_id,
                direction=job.direction,
                state=consensus.state,
                captured_at=job.estimated_captured_at_server,
                confidence_category=confidence_category(consensus.consensus_score),
            ),
        )
        repository.complete(
            job=job,
            observation_id=identifier,
            outbox_id=outbox_id(job.capture_id),
            consensus=consensus,
            event=event,
            started_at=started,
            completed_at=completed,
            derived_crop_keys=derived_keys,
            model_version=MODEL_VERSION,
        )
        metrics.add_metric(
            name="RecognitionProcessingDuration",
            unit=MetricUnit.Milliseconds,
            value=(completed - started).total_seconds() * 1000,
        )
        metrics.add_metric(
            name=consensus.state.value.title().replace("_", ""),
            unit=MetricUnit.Count,
            value=1,
        )
        logger.append_keys(observation_id=identifier)
        logger.info("recognition completed", extra={"state": consensus.state.value})
    except Exception as error:
        logger.exception(
            "recognition processing failed",
            extra={"error_type": type(error).__name__},
        )
        repository.fail(job, type(error).__name__)
        metrics.add_metric(name="RecognitionFailures", unit=MetricUnit.Count, value=1)
        raise


@logger.inject_lambda_context(clear_state=True, log_event=False)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: Any) -> Any:
    if len(event.get("Records", [])) > 1:
        raise ValueError("recognition worker requires SQS batch size 1")
    return process_partial_response(
        event=event,
        record_handler=record_handler,
        processor=processor,
        context=context,
    )
