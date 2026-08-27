# artifact-assembly

Generic, lock-driven artifact composition for OPS.

The package knows only artifact kinds and lock fields. Product IDs, renderer behavior, domain reducers, deployment targets, and authority decisions stay outside its source.

It validates canonical JSONL locks, exact digests, npm package identity and exports, safe paths, archive entry types, and output collisions. Assembly happens in a staging directory. The previous output is restored if promotion fails. The returned receipt is generated evidence with `authority=false` and schema `roccho.artifact.assembly-receipt/2`.
