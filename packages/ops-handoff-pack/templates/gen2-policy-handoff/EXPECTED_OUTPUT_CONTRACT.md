# Expected Output Contract

## Worker

Required:
- `GEN2_READBACK.json`
- changed file list or explicit no-change report
- commands run and outputs summarized
- evidence refs to files/logs/commits
- blocker list if any

Forbidden:
- claim completion approval
- claim semantic approval
- use stub proof as real proof
- edit ssot directly

## Reviewer

Required:
- PASS/BLOCK
- finding table: severity, file/line or artifact ref, evidence, required fix
- authority boundary check
- proof quality check
- remaining blockers

A PASS is valid only when evidence is local, readable, and scoped to the claim.
