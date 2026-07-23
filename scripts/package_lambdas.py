#!/usr/bin/env python3
"""Build deterministic ZIP Lambda assets from a Linux container."""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

SERVICES = {
    "control-api": "control_api/gatesight_control_api",
    "outbox-publisher": "outbox_publisher/gatesight_outbox_publisher",
    "visit-projector": "visit_projector/gatesight_visit_projector",
    "security-evaluator": "security_evaluator/gatesight_security_evaluator",
    "heartbeat-monitor": "heartbeat_monitor/gatesight_heartbeat_monitor",
}


def copy_tree(source: Path, destination: Path) -> None:
    shutil.copytree(source, destination, dirs_exist_ok=True)


def archive(directory: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            relative = path.relative_to(directory)
            info = zipfile.ZipInfo.from_file(path, relative.as_posix())
            info.date_time = (2020, 1, 1, 0, 0, 0)
            info.external_attr = 0o644 << 16
            target.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--layer", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    for archive_name, service_path in SERVICES.items():
        with tempfile.TemporaryDirectory(prefix=f"{archive_name}-") as temporary:
            root = Path(temporary)
            copy_tree(arguments.layer, root)
            copy_tree(
                arguments.source / "packages/python_domain/gatesight_domain",
                root / "gatesight_domain",
            )
            package_name = Path(service_path).name
            copy_tree(
                arguments.source / "services" / service_path,
                root / package_name,
            )
            archive(root, arguments.output / f"{archive_name}.zip")


if __name__ == "__main__":
    main()
