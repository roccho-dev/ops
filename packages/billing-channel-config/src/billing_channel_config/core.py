"""Public billing-channel core facade.

Schema validation, channel selection, and diagnostics are implemented in
core_impl.py; this facade preserves the public import boundary.
"""
from __future__ import annotations

from .core_impl import *  # noqa: F401,F403
