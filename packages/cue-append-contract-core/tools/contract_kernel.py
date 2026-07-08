#!/usr/bin/env python3
"""Compatibility wrapper for the proof-only Python contract kernel.

Core implementation is intentionally Go+CUE+JSONL.  This wrapper preserves the
existing TDD scripts while making the Python implementation explicit proof/helper
infrastructure, not a core package.
"""
from __future__ import annotations

import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "proof" / "python" / "contract_kernel.py"
runpy.run_path(str(TARGET), run_name="__main__")
