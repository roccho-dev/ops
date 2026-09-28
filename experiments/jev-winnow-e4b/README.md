# Jev vs Winnow E4B benchmark

Status: **DONE / OBSERVED**. Finite comparison; not an adoption decision.

## Purpose

Compare the existing hosted Jev path with Ollaya + `winnow:e4b` on the same frozen ops semantic workload.

The benchmark reuses the existing `packages/parallel-development/tests` corpus:

- 18 fixed semantic cases;
- declared and reversed candidate order;
- 36 requests;
- 72 Noul judgments;
- gold loaded only after every provider request completes;
- the same question construction, ranking and scorer.

## Winnow selection

`winnow:e4b` was selected for this Jev-like workload rather than simply choosing the largest Winnow.

At the time of the proof, Ollaya recommends E4B as the Winnow accuracy/speed option, and its published typed-decisions score is 0.722 versus 0.702 for Winnow 12B. The 12B model is stronger on some broader public sets; this selection is therefore workload-specific, not a claim that E4B is universally stronger.

Reference: https://ollaya.dev/library/winnow

## Comparable corpus

The historical live Jev proof and this Winnow proof use byte-identical model-visible cases and runner-only gold.

Git blob identity, historical Jev source `f367866a90c89d9d62b9f8c23613ad56b631a39e` vs current source:

- `cases.jsonl`: `eb9931b5ae90b71b3bdc2780075bbcded7e65678` = same;
- `expected.jsonl`: `38afa0f8c55969c59217b0918440f92f2e2001ef` = same;
- `jev-review/core.mjs`: `2331f7983430aa5aff9d36612e3dcccd68d4c0e8` = same;
- `jev-review/review.mjs`: `fe1d60406884439589a2d3b097175687f3f092a6` = same.

The later phase/scorer changes only generalized candidate-count validation and added derived effect metrics; they did not change the two-candidate questions or preferred-higher / tie / stability meaning used here.

Content digests observed by the Winnow run:

- cases SHA-256: `ed8fd0664efa1ce99df73082ef016cf6c137b1df1814987d012d65b31873c098`
- expected SHA-256: `420038bfb874dc1a35a91d5420810a7747355983b82da5b5d450563d165f6261`

## Result

| metric | Jev 1.13.0 | Ollaya v0.7.5 + Winnow E4B |
|---|---:|---:|
| requests | 36 | 36 |
| Noul judgments | 72 | 72 |
| preferred-higher | **36 / 36** | **35 / 36** |
| preferred-lower | 0 | 1 |
| ties | 0 | 0 |
| stable cases | **18 / 18** | **17 / 18** |
| unstable cases | 0 | 1 |
| gold leakage | 0 | 0 |

The only Winnow miss was `case-06 / cut / acceptance-weakness`.

- declared order: preferred `0.3843`, other `0.4385` → wrong order;
- reversed order: preferred `0.8850`, other `0.3971` → correct order.

So the observed gap is one order result and one stable case, and the failure is specifically order-sensitive. Because of that miss, Winnow did not preserve complete gold coverage under top-1 attention on this corpus.

## Winnow CPU execution

Canonical run:

- https://github.com/roccho-dev/ops/actions/runs/36410467310
- executed head: `31244557cb4740f6b94ef4e540fd921e5ca304b5`
- evidence artifact: `10964434312`
- artifact digest: `sha256:4c5ee1b95e86220a400579efb7b93bb0311f866dced10cc228dc4077e2a5e33c`

Environment and observed runtime:

- GitHub hosted Ubuntu 24.04 runner;
- 15 GiB RAM;
- CPU;
- Winnow precision: `Q8_0`;
- model load: `10,034 ms`;
- benchmark input tokens: `35,104`;
- output tokens: `0`.

Request latency:

- mean: **34.266 s**;
- p50: **33.748 s**;
- p95: **39.771 s**;
- max: **39.869 s**.

The 36 sequential benchmark requests therefore consumed about 20.6 minutes of measured request time after warm-up.

## Jev evidence

Canonical historical live proof:

- ops source: `f367866a90c89d9d62b9f8c23613ad56b631a39e`;
- envs proof source: `4cc4bdec1c684fd253c834c5c3247e23fbedd1c6`;
- run: https://github.com/roccho-dev/envs/actions/runs/35673274907
- retained record: https://github.com/roccho-dev/ops/pull/402#issuecomment-5769672845
- artifact ID: `10671854193`;
- artifact digest: `sha256:9d766c24fa1e6948d91eeb63d42091bc42fef3c58329f7437ae23910aba5e2d1`.

That proof recorded quality/stability but did not retain per-request latency, so this benchmark does **not** claim an apples-to-apples Jev-vs-Winnow latency ratio.

A separate voice-ui live measurement records roughly 0.3 s median over 56 Jev v4 calls, but it is a different workload and is intentionally not used as the comparison score here.

## Economic proxy

Current public reference prices observed on 2026-09-29:

- TypeSafe Jev input: **$0.042 / 1M input tokens**; output is unmetered.
- RunPod RTX 4090 Secure Cloud: **$0.74 / hour**.
- Ollaya's published Winnow E4B GPU latency is about **90 ms/request** on an RTX 4090-class measurement.

Sources:

- https://typesafe.ai/
- https://typesafe.ai/blog/introducing-system-one-models-and-jev
- https://www.runpod.io/pricing
- https://ollaya.dev/library/winnow

The frozen Winnow run reported **35,104 input tokens / 36 requests**, or about **975 input tokens/request**. Jev uses its own tokenizer, so reusing that token count is only a cost proxy, not a billed Jev receipt.

Using that proxy:

| quantity | Jev hosted | Winnow E4B on dedicated RTX 4090 |
|---|---:|---:|
| assumed tokens/request | 975 | n/a |
| variable cost / 1,000 requests | **~$0.041** | **~$0.0185** at 90 ms/request |
| judgments/request in this benchmark | 2 | 2 |
| variable cost / 1,000 judgments | **~$0.0205** | **~$0.00925** |
| idle capacity cost | none beyond API usage | **$0.74/hour** while provisioned |

The dedicated-GPU number assumes continuous useful work. At 90 ms/request the theoretical single-stream ceiling is about **40,000 requests/hour**. Under the token proxy above, a $0.74/hour GPU needs roughly **18,100 requests/hour**, or about **45%** of that sequential capacity, before its raw compute cost falls below Jev's metered cost.

Therefore:

- **sporadic / bursty use:** Jev is economically simpler and likely cheaper because there is no idle GPU;
- **sustained high-volume use:** Winnow on an already-busy GPU can have lower marginal compute cost;
- **CPU local:** the observed ~34 s/request is too slow for an immediate CI semantic decision path regardless of marginal compute price.

These are infrastructure economics only. They do not override the observed quality gap of Jev 36/36 vs Winnow 35/36.

## Interpretation boundary

This result establishes, for this frozen ops workload:

> Jev 1.13.0 separated all 36 paired orders; Winnow E4B separated 35/36 and showed one candidate-order instability.

It also establishes that Winnow E4B can run locally on a standard 15 GiB GitHub CPU runner, but sequential CPU inference is tens of seconds per request on this setup.

It does **not** establish:

- universal Jev or Winnow quality;
- production precision;
- a fair same-hardware latency comparison;
- that a GPU or persistent Winnow worker would have the same latency;
- that Jev should be retired.

## Final-tree boundary

The benchmark workflow and runner were one-shot proof machinery. After the successful evidence was recorded, they were removed from the final PR tree.

The final durable diff is this evidence record only. Exact executed source remains recoverable from Git history at `31244557cb4740f6b94ef4e540fd921e5ca304b5`.
