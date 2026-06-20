# Project Source Upload Plan

- Use revisioned file names with packet id or content hash.
- Upload through Project Source only when ChatGPT is the gen2 target.
- First gen2 reply must echo `sourcePacketRevision`, `readProjectSourceFiles[]`, and `unreadableProjectSourceFiles[]`.
- Same-name upload visibility is not worker-readable proof.
- Thread attachments, inline source bodies, archive text, and base64 are not fallback.
- If archive readback fails, keep archive as audit evidence and upload loose worker-readable files with verdict ceiling lowered.
