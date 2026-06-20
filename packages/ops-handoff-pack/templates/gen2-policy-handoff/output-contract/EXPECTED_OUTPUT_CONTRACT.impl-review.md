# Expected Output Contract: impl-review

Required first readback:

- `contextPacketId`
- `actorId`
- `roleId: role.chatgpt.thread`
- `threadFunction: impl-review`
- fixed policy refs and rendered digests read
- source refs read
- impl-work artifact source read
- forbidden actions understood

Required final artifact:

- `GEN2_IMPL_REVIEW_READBACK.json`
- `IMPL_REVIEW_VERDICT.md`
- PASS/BLOCK table with evidence refs
- authority boundary check
- proof quality check
- remaining blockers

Ceiling: impl-review cannot edit implementation, perform merge-work, approve canonical merge, or claim overall completion approval.
