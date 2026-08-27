# Publisher continuation verification

Cross-repository verifier for the large semantic-map continuation boundary. It proves that an oversized accepted update is planned without side effects, requires explicit publication, commits only after a validated storage receipt, reopens through the resulting digest reference, and preserves a local draft until the user either publishes or rejects it.

Run with an extracted mobile-agent repository path:

`node verification/publisher-continuation/verify.mjs <mobile-agent-repository>`
