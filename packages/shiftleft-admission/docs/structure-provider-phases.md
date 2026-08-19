# Structure provider phases

## Fixed boundary

```text
ast-grep observes source structure
policyctl selects and normalizes providers
Gate decides met / unmet / unobserved / not-applicable
Receipt binds policy, tool, rulepack, and candidate identity
```

Pkl or JSONL may author rules, profiles, contracts, and tasks. They do not execute providers, native tests, candidate-drift checks, or Receipt binding.

## Phase 0 — minimum Core

```mermaid
sequenceDiagram
    participant U as user
    participant C as chat.pro
    participant G as github

    U->>C: implementation and checks
    C->>G: fetch exact policy and source
    G-->>C: rules source hashes
    C->>C: run provider
    C->>C: fold Observation through Gate
    C->>C: emit Receipt
    C-->>U: result and Receipt
```

## Phase 1 — shadow parity

The former Go, JavaScript, and Python import parsers and ast-grep ran on identical source bytes. Good, bad, false-positive, false-negative, and syntax-variant cases had the same normalized `shiftleft-import-report/1` meaning. Parity evidence remains in Issue #172 and Git history; it is not shipped as a second active provider.

## Phase 2 — active ast-grep provider

```mermaid
sequenceDiagram
    participant U as user
    participant C as chat.pro
    participant G as github

    U->>C: request structure check
    C->>G: fetch exact policy tool and current head
    G-->>C: exact bytes and hashes
    C->>C: inspect JavaScript Python and Go
    C->>C: verify fixtures and native tests
    C->>C: normalize Observations
    C->>C: emit Receipt through unchanged Gate
    C->>G: optionally submit candidate and Receipt
    G-->>C: authoritative readback
    C-->>U: complete or fail closed
```

Active assets:

```text
providers/structure/astgrep/normalize.mjs
rulepacks/astgrep/<language>/forbidden-imports.yml
toolchains/astgrep.lock.json
policy/profiles.jsonl
```

The custom per-language import parsers are removed from the active tree. Git history is the retirement store.

## Phase 3 — add only a needed provider

```text
provider addition
= adapter
+ profile
+ pinned tool or config
+ good / bad / false-positive / false-negative fixtures
```

The fixed Core does not grow for a new inspection tool.

## Remains native or custom

- exact tool, adapter, and rulepack identity;
- safe process execution and timeout;
- ast-grep JSON parsing and Observation normalization;
- Package in/out/error/effect and golden/negative route checks;
- native tests and compiler/type/linter evidence;
- runtime stdout/stderr contracts;
- cross-file graph, dataflow, runtime, and semantic checks not proven by an ast-grep rule;
- workspace/candidate binding, drift detection, Gate, Receipt, and #114 admission.

Semgrep is added only when a concrete flow-sensitive rule exists. Pkl is added only when measured configuration duplication justifies it.
