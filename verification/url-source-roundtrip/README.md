# URL source round-trip verification

Cross-repository verifier for the public semantic-map source contract. It constructs an accepted DecisionLog, creates both inline and digest-reference URLs, decompiles them, and verifies canonical State JSONL, exact accepted DecisionLog JSONL, complete Envelope JSON, and separately exposed Proposal preview state.

Run with an extracted mobile-agent repository path:

`node verification/url-source-roundtrip/verify.mjs <mobile-agent-repository>`
