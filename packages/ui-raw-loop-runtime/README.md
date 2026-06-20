# ui-raw-loop-runtime

Operational collector/projection package for the UI raw loop.

It owns runtime mechanics only:

- receive `POST /api/raw`
- validate non-authority `owner.raw.input.v1` envelopes
- append to raw JSONL
- project a UI read model with goal counts and mention index
- serve `GET /read-model`

It does not decide adrs promotion, approval, merge readiness, or package authority.
