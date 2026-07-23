"""Credential-gated tests against a temporary deployed dev environment.

Mocks and LocalStack are intentionally not accepted as evidence for this suite.
"""

from __future__ import annotations

import os

import boto3
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("GATESIGHT_AWS_E2E"),
    reason="set GATESIGHT_AWS_E2E=1 only for an authorized temporary AWS environment",
)


def test_real_queue_and_bucket_are_private_and_encrypted() -> None:
    region = os.environ["AWS_REGION"]
    bucket = os.environ["GATESIGHT_CAPTURE_BUCKET"]
    queue_url = os.environ["GATESIGHT_RECOGNITION_QUEUE_URL"]
    s3 = boto3.client("s3", region_name=region)
    sqs = boto3.client("sqs", region_name=region)
    public = s3.get_public_access_block(Bucket=bucket)["PublicAccessBlockConfiguration"]
    assert all(public.values())
    encryption = s3.get_bucket_encryption(Bucket=bucket)
    assert (
        encryption["ServerSideEncryptionConfiguration"]["Rules"][0][
            "ApplyServerSideEncryptionByDefault"
        ]["SSEAlgorithm"]
        == "aws:kms"
    )
    attributes = sqs.get_queue_attributes(QueueUrl=queue_url, AttributeNames=["All"])["Attributes"]
    assert attributes["KmsMasterKeyId"]
    assert attributes["RedrivePolicy"]
