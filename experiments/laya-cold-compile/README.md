# Laya cold-compile PoC

Status: finite experiment; not adoption.

## Purpose

Prove or falsify one narrow claim:

> Existing ops semantic judgments can be compiled into a CPU-local Laya checkpoint that retains more of the desired judgment behavior on a frozen regression holdout than the untuned checkpoints.

This PR is about **compile feasibility**, not about growing Laya, replacing Jev, or proving business value.

## Inputs

- Tune corpus: repo-health semantic examples plus DAG discriminative gold.
- The tune corpus must not contain the frozen holdout cases or labels derived from their expected answers.
- Frozen regression holdout: the exact 18 cases used by ops#404, evaluated in both candidate orders (36 comparisons).

Current baselines recorded before this experiment:

| checkpoint | expected-order hits | stable cases |
|---|---:|---:|
| laya-multilingual | 18 / 36 | 2 / 18 |
| laya-typed-decisions | 23 / 36 | 8 / 18 |

The holdout definition must not change inside this experiment.

## Experiment

1. Materialize the exact base checkpoint and exact tune corpus with immutable revisions/digests.
2. Split only the tune corpus into training/selection data.
3. Fine-tune within a fixed compute/run budget without reading the #404 expected answers.
4. Select the checkpoint using tune-corpus evidence only.
5. Freeze the selected checkpoint and record its digest and training receipt.
6. Run the frozen #404 holdout once against that selected checkpoint.
7. Record hit count, order stability, CPU latency, artifact size, and the exact inputs used.

If the final #404 result is used to change training, that result is no longer a holdout result. A new experiment with a new holdout/version is required.

## Technical verdict

- **PASS**: the selected tuned checkpoint improves both expected-order hits above 23/36 and stable cases above 8/18 on the frozen holdout.
- **RED**: it does not.
- Execution failure is recorded separately from semantic RED.

PASS means only:

> local ops judgment data produced a measurable cold-compile effect on this bounded task.

PASS does **not** authorize model adoption or further tuning.

## Stop / next decision

This PR stops after the before/after evidence is recorded.

After PASS, the next question is not “how do we tune more?” It is:

> Which real repeated decision, if any, is worth replacing, and is a tuned model cheaper than reusing an existing decision, a rule/program, Jev, or an untuned local model?

That is a separate use-site decision and, if justified, a separate PR.

After RED, keep the evidence and stop. Do not continue training merely to improve this benchmark.

## Non-goals

- production cutover;
- Jev retirement;
- changing auth or decision/effect authority;
- using #404 as iterative training feedback;
- adding a model registry or permanent training platform;
- changing the generic Carry responsibility in ops#430;
- claiming business value from benchmark improvement alone.

## Relationship

- roccho-dev/adrs#432: purpose and investment boundary.
- roccho-dev/adrs#394: Program / System 1 / System 2 responsibility boundary.
- roccho-dev/ops#404: frozen semantic regression corpus.
- roccho-dev/ops#430: generic large-artifact Carry only.

This PR is stacked on ops#430 only to reuse its generic Carry path. Once #430 lands, retarget this PR to `proposals` without importing tuning responsibility into #430.
