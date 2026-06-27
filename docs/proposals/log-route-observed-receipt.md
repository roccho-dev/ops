# Log route observed receipt

## Purpose

Define the ops-side receipt for observed log route evidence.

## Scope

The receipt records whether a deployed revision produced evidence at a log sink.

## Fields

- receiptKind
- receiptId
- deploymentId
- serviceRef
- environment
- targetKind
- revisionRef
- logSinkRef
- evidenceKind
- observedAt
- freshnessState
- validityWindow
- sourceDigest
- authority

## Boundary

- no ADRS policy ownership
- no deployment inventory feed
- no governance join check
- no target adapter

## Follow-up

Provider-specific log adapters are later PRs.
