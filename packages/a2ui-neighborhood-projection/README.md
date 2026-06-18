# a2ui-neighborhood-projection

Proposal package for deterministic projection from admitted context graph JSONL
into `a2ui.context.surface.v1`.

This package is an execution/projection host only. It does not make raw JSONL,
A2UI, WebMCP, or browser graph replay authoritative.

Input rows are intentionally small:

- `context.namespace.v1`
- `context.roleBinding.v1`
- `context.current.v1`
- `context.node.v1`
- `context.edge.v1`

The output contains the current node, mutable namespace, `role = policies[]`,
up/down/left/right/around neighborhood, relevant edges, caveats, render hints,
and authority boundary flags.
