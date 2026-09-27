# Laya cold-compile PoC

Status: **DONE / RED / stopped**. Finite compile-feasibility experiment; not adoption.

## Purpose

Prove or falsify one narrow claim:

> Existing ops semantic judgments can be compiled into a CPU-local Laya checkpoint that retains more of the desired judgment behavior on a frozen regression holdout than the untuned checkpoints.

This experiment is about compile feasibility. It does not authorize Laya adoption, Jev retirement, production cutover, or another tuning cycle.

## Final verdict

| checkpoint | expected-order hits | stable cases |
|---|---:|---:|
| laya-multilingual baseline | 18 / 36 | 2 / 18 |
| laya-typed-decisions baseline | **23 / 36** | **8 / 18** |
| bounded tuned checkpoint | **21 / 36** | **7 / 18** |

Contract:

- PASS = tuned checkpoint is above 23/36 **and** above 8/18.
- RED = otherwise.

Observed: **RED**.

The bounded tune did not improve the strongest untuned baseline; it regressed from 23→21 expected-order hits and 8→7 stable cases. This is a completed falsification result for this experiment, not an execution failure.

## Execution evidence

Canonical proof run:

- GitHub Actions run: https://github.com/roccho-dev/ops/actions/runs/36280839996
- executed PR head: `2ded1e44f0f14194a39b3109493566dbf15b21ea`
- workflow conclusion: **success**
- train job: **success**
- evaluate job: **success**
- semantic verdict emitted by the successful workflow: **RED**

The transient `train.py`, `evaluate.py`, and proof workflow existed at the executed proof commit above. They are deliberately absent from the final tree: this PR records a completed one-shot experiment, not a permanent training platform or undeclared CI workflow. Exact execution source remains recoverable from Git history.

## Frozen inputs

Base checkpoint:

```text
repo: convaiinnovations/laya-typed-decisions
revision: 1a793eb568e6718f15941d08f85432581df534e3
model SHA-256: 4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e
```

Tune corpus was independent of the #404 holdout:

```text
repo-health/design cases SHA-256:
4917f44b728f390bd70212e6ab0267ba5f45da6f9825069babc9fb27de277fea

repo-health/DAG cases SHA-256:
5798ede795e262d880a43acb9158523efbcbf081ee523e0548e3995fd3189629

repo-health/DAG gold SHA-256:
4f2bbdbbb5635680203f1d1e79ba36af94b85eb917abddc6d1d773b5e3424240

normalized 28-pair corpus SHA-256:
c7f1a47c325ebaf4b01b5e466d5c0ebda1151f8d6dee4ae9601092a750455d11
```

Deterministic split:

```text
seed: 432
train pairs: 21
selection pairs: 7
```

Checkpoint selection used only the seven tune-corpus selection pairs. The best selected checkpoint was epoch 4:

```text
selection expected-order hits: 8 / 14
selection stable pairs: 1 / 7
selection mean BCE: 0.6956903423581805
```

## Holdout exclusion

Training used sparse checkout containing only:

- this experiment;
- repo-health design cases;
- repo-health DAG cases;
- repo-health DAG gold.

`packages/parallel-development/tests` was not present in the training checkout, and the training program failed closed if that path existed.

The #404 holdout was read only by the separate evaluate job after the selected checkpoint was frozen.

Frozen holdout:

```text
cases: 18
orders: 36
cases SHA-256:
ed8fd0664efa1ce99df73082ef016cf6c137b1df1814987d012d65b31873c098

expected SHA-256:
420038bfb874dc1a35a91d5420810a7747355983b82da5b5d450563d165f6261
```

Gold was loaded only after all 36 frozen-checkpoint inference requests completed.

## Bounded training receipt

```text
epochs: 4
batch: 4
learning rate: 0.0002
weight decay: 0.01
encoder frozen: true
trainable parameters: 26,512,131
CPU threads: 4
selected epoch: 4
training elapsed: 1,593.8 s
```

No #404 result was used to select or modify the checkpoint.

## Frozen checkpoint

```text
model SHA-256:
8dd3651bfbce082d33c74d3c5f9adf457f940885e793c2cefdef4fdf5e528cf7

artifact bytes:
846,195,764
```

Historical checkpoint artifact from the proof run:

```text
artifact ID: 10919526013
artifact name: laya-cold-compile-selected
uploaded ZIP SHA-256:
22e3600f0f674697247b08802c8b4fb5945d6d99155810c3a80e79a741476da0
```

The Actions artifact is temporary; the durable authority for this experiment is the recorded digests, exact proof commit, run, and result in this file/PR.

## Frozen holdout result

```text
expected-order hits: 21 / 36
preferred-lower: 13 / 36
ties: 2 / 36
stable cases: 7 / 18
unstable cases: 11 / 18

CPU latency:
  mean   4.788 s
  median 4.792 s
  max    6.116 s
```

Total measured frozen-holdout inference time implied by the 36 per-order measurements is about 172.4 CPU-seconds.

The runtime emitted a warning about clamping a `choice:11+` temperature entry. This PoC trained and evaluated only `noul` questions, so that choice-only warning was outside the measured decision path.

## Evidence receipt

Historical evidence artifact:

```text
artifact ID: 10919580356
artifact name: laya-cold-compile-evidence
uploaded ZIP SHA-256:
153e74e14784dd43336ccde286a09356e2f14c3ba646448a54442ff78ade5aba
```

Structured evidence content digest:

```text
evidence SHA-256:
e0da2fdf6a9623d1d0a6b131ab81fcf5a782fefc4a1ebfcb4f30c21f7e41dea6
```

## Interpretation boundary

This result proves only:

> Under this fixed base checkpoint, fixed independent tune corpus, fixed four-epoch head-only CPU budget, tune-only checkpoint selection, and one frozen #404 evaluation, the bounded fine-tune did **not** beat the strongest untuned Laya baseline.

It does not prove:

- Laya can never be fine-tuned successfully;
- another corpus, training method, or compute budget would also be RED;
- Jev should be replaced;
- production quality or business value;
- a real repeated use-site should use a tuned model.

## Stop

The experiment contract is complete.

```text
bounded tune
    ↓
checkpoint selected without #404
    ↓
checkpoint frozen
    ↓
#404 holdout once
    ↓
RED
    ↓
STOP
```

Do not tune again inside this PR to improve the frozen benchmark.

Any future tuning requires a separate use-site decision: first identify one real repeated judgment, then compare existing-decision reuse / rule or program / Jev / untuned local model / tuned model on quality and total cost.

## Relationship

- roccho-dev/adrs#432 — CPU-local System One evidence and investment boundary.
- roccho-dev/adrs#394 — Program / System 1 / System 2 responsibility boundary.
- roccho-dev/ops#404 — frozen semantic regression corpus.
- roccho-dev/ops#430 — generic exact Carry only.

#430 remains generic Carry. This completed experiment does not add tuning responsibility to it.
