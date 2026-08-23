#!/usr/bin/env python3
"""Entry point for the ops-decision-closure world-core compatibility tool."""
from __future__ import annotations

import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from world_core.cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
