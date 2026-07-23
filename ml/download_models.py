#!/usr/bin/env python3
"""Download manifest-pinned model artifacts during the container build."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import tempfile
import urllib.request
from typing import Any
from urllib.parse import urlparse


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(artifact: dict[str, Any], output: pathlib.Path) -> pathlib.Path:
    destination = output / artifact["filename"]
    if destination.is_file() and sha256(destination) == artifact["sha256"]:
        return destination
    output.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".model-", dir=output)
    os.close(descriptor)
    temporary = pathlib.Path(temporary_name)
    try:
        source_url = str(artifact["sourceUrl"])
        parsed_url = urlparse(source_url)
        if parsed_url.scheme != "https" or parsed_url.hostname not in {
            "github.com",
            "objects.githubusercontent.com",
        }:
            raise ValueError("model source must be an approved HTTPS GitHub host")
        request = urllib.request.Request(  # noqa: S310
            source_url, headers={"User-Agent": "GateSight model builder/1.0"}
        )
        with (
            urllib.request.urlopen(request, timeout=120) as response,  # nosec B310  # noqa: S310
            temporary.open("wb") as target,
        ):
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
        actual = sha256(temporary)
        if actual != artifact["sha256"]:
            raise ValueError(
                f"checksum mismatch for {artifact['name']}: expected "
                f"{artifact['sha256']}, received {actual}"
            )
        if temporary.stat().st_size != artifact["bytes"]:
            raise ValueError(f"size mismatch for {artifact['name']}")
        temporary.replace(destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument(
        "--require-redistribution-approval",
        action="store_true",
        help="Fail unless every artifact is explicitly approved; production release must use this.",
    )
    arguments = parser.parse_args()
    manifest = json.loads(arguments.manifest.read_text())
    if arguments.require_redistribution_approval:
        blocked = [
            artifact["name"]
            for artifact in manifest["artifacts"]
            if artifact["redistributionStatus"] != "APPROVED"
        ]
        if blocked:
            raise SystemExit(f"model redistribution approval is required: {', '.join(blocked)}")
    paths = [fetch(artifact, arguments.output) for artifact in manifest["artifacts"]]
    if arguments.verify:
        for artifact, path in zip(manifest["artifacts"], paths, strict=True):
            if sha256(path) != artifact["sha256"]:
                raise SystemExit(f"verification failed for {artifact['name']}")
    print(json.dumps({"verified": [path.name for path in paths]}, separators=(",", ":")))


if __name__ == "__main__":
    main()
