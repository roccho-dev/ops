# artifact-assembly

Generic, lock-driven artifact composition for OPS.

The package knows only artifact kinds and lock fields. Product IDs, renderer behavior, domain reducers, deployment targets, and authority decisions stay outside its source.

It remains the sole owner of canonical JSONL lock validation, archive/file/tree digests, npm package identity and exports, safe extraction, relative shims, output collision checks, and assembly receipts.

## Fresh-path contract

`outputDir` must not exist, including as an empty directory, file, symlink, or dangling symlink. Directory inputs must not contain the output staging parent or temporary scratch parent. Checks run before workspace creation. Each call creates fresh staging and scratch directories; neither the assembler nor its tests delete them, on success or failure.

After staging validates, an exclusive `mkdir` claims the output. Files are copied with exclusive creation and the output digest is checked before returning a `PASS` receipt. A late destination collision is rejected, not renamed, merged, backed up, or overwritten. Publication is **not an atomic directory replacement**: copy failure may leave an incomplete fresh output, but returns no receipt and never retries or deletes it. Consumers must wait for success and validate the receipt; directory existence is not success. Retry with new output and receipt paths.

`writeAssemblyReceipt` also creates exclusively. The receipt remains generated evidence with `authority=false` and schema `roccho.artifact.assembly-receipt/2`; its existing digest format is unchanged. The only supported failure injection is `before-promote`; `after-backup` is retired because no backup/replacement occurs.

CLI consumers keep the same API/arguments but must select an absent output and receipt. Existing fresh-path consumers keep their output bytes, shims, and receipt format. Callers depending on replacement must explicitly choose a new destination; no compatibility cleanup or fallback is provided. Retained test/staging/scratch data belongs to the enclosing environment's lifetime or separately authorized disposal, not reusable recursive cleanup code.

Run `node packages/artifact-assembly/tests/run.mjs` from the repository root. The tests retain their fresh temporary directories and cover no-deletion guards, existing and late output collisions, failed publication without a success receipt, repeatability, and the existing lock/archive/export/purity checks.
