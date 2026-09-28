# Bounded secret-effect path admission (#436)

The existing CI intent checker now parses YAML with pinned `yq-go` instead of treating indentation and a variable name as a proof. It walks `needs` from each secret-bearing job and checks every contributing Action and checkout, including earlier steps and upstream jobs.

The accepted source shape is deliberately narrow: the workflow and checked-out executable source are the same exact `github.sha`; every contributing third-party Action has a full commit pin; effect events are explicit manual/owner-command boundaries; failures are not ignored. Local/reusable actions, matrix jobs, unknown expression forms and runtime package installers are rejected until explicitly supported. `source_sha` is not a trusted value merely because of its spelling.

This is test-first migration work. Existing effect workflows are expected to be rejected where they use mutable Actions, indirect/unproven checkout sources or runtime npm acquisition. Do not relax the gate to recover Green. For each rejected path, delete it when obsolete, or migrate its still-required behavior to the smallest approved runtime. No accepted branch or running deployment is changed until the PR is reviewed and merged.

This bounded workflow admission is NOT a theorem about arbitrary shell scripts or recursively imported application code. Approved executable dependency closures and physical Environment protections remain separate obligations. Do not call #436 complete based only on the unit selftests, nor consume the old accepted classifier's Green as proof of these new conditions.

Remaining before merge/closure: migrate or retire rejected paths, preserve historical-fallback rejection, bind real executable closures, validate the entire exact candidate, then record the approved live-effect positive. The same voice-ui run may supply that live positive; do not repair obsolete Seq transport just to obtain one.
