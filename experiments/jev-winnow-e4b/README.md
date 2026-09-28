# Jev vs Winnow E4B benchmark

Status: **PENDING**. Finite comparison; not an adoption decision.

## Purpose

Compare the existing hosted Jev path with Ollaya + `winnow:e4b` on the same frozen ops semantic workload.

The benchmark reuses the existing `packages/parallel-development/tests` corpus:

- 18 fixed semantic cases;
- declared and reversed candidate order;
- 36 requests;
- 72 Noul judgments;
- gold loaded only after every provider request completes;
- the same `reviewPhase` and `summarize` scorer for both providers.

## Provider pins

- Jev: `jev-1.13.0`
- Ollaya: `v0.7.5`
- Winnow: `winnow:e4b`
- Ollaya device: CPU

`winnow:e4b` is selected because Ollaya currently recommends it as the Winnow accuracy/speed choice and it scores 0.722 on typed-decisions versus 0.702 for Winnow 12B.

## Comparable claim

A provider comparison is valid only when both evidence files have the same:

- cases SHA-256;
- expected SHA-256;
- request count;
- judgment count;
- question construction and scorer implementation.

The comparison reports, without turning the benchmark into an execution gate:

- expected-order hits / 36;
- stable cases / 18;
- reversed/tie counts;
- request latency p50/p95/max;
- aggregate usage fields when the provider returns them;
- execution failures.

## Boundary

This corpus is ops-specific. A result supports only the claim:

> relative behavior on this frozen ops semantic discrimination workload.

It does not establish universal model quality or authorize Jev replacement.
