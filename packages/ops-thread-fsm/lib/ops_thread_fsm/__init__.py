"""ops-thread-fsm controller package.

The package is intentionally controller-only: it models states, permissions,
readback classification, evidence checks, and readiness decisions. It does not
implement CDP, push, refs-vault, artifact materialization, local gates,
external-thread mechanics, or canonical merge.
"""

__all__ = ["__version__"]
__version__ = "0.2.0"
