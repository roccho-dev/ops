# Test meaning and Go contract

The Go suite is the canonical behavior contract. It preserves the serialized meanings first extracted from 16 Node/MJS tests.

## Coverage

- historical MJS source files: **16**
- historical assertion call sites: **540**
- semantic behavior groups: **154**
- canonical implementation: **Go**
- exact deep-nesting proof: **20,000 levels**

The historical JSONL inventory remains append-only evidence. Git history contains the exact MJS source bytes and recorded SHA-256 values; the active test suite no longer requires Node or MJS files to execute.

## Active contract

The suite fails unless:

- all 154 meaning IDs are unique;
- the inventory accounts for exactly 16 source files and 540 assertions;
- every `ported-required` or `selective-port` meaning resolves to an existing Go test;
- stale migration test names do not reappear;
- promotion output is detached from input;
- deep valid JSON has bounded resource growth and accepts 20,000 levels;
- CLI, queue, worker, receipt, projection, admission, proposal, promotion, authority, and canonical JSON behavior remain green.

JavaScript-object-only and unused-adapter rows remain historical evidence of the deliberately retired surface.
