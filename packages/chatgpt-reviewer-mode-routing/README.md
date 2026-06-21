# ChatGPT reviewer mode routing validator

Validates Gen2 ChatGPT operation evidence against the ADRS guardrail law.

Required routing:
- `github_operation` requires `extra_high` (`extra high`, `最高`).
- `non_github_review_operation` requires `pro_extended` (`pro extended`, `pro拡張`).

Mixed operations are rejected. The validator checks evidence shape only and grants no approval.
