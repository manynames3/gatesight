#!/usr/bin/env python3
"""Export the FastAPI schema used for TypeScript generation and compatibility review."""

import json
from pathlib import Path

from gatesight_control_api.main import app

target = Path("packages/contracts/openapi.json")
target.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
