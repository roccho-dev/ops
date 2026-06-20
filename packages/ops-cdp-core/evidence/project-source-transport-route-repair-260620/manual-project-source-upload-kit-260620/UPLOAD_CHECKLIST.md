# Manual Project Source Upload Checklist 260620

This kit is for a transportOnlyActor using a Project Source-capable browser surface.
It does not grant semantic approval, completion approval, merge approval, or route decision.

## Target

- Project URL: https://chatgpt.com/g/g-p-6a3484c5583881918758f110063340d9/project
- Project name observed earlier: remove-policy
- Required upload surface: Project Sources / information sources, not thread attachment

## Upload Files

Upload every file under `files/` as Project Sources, preserving filenames.
Do not inline file contents into a chat message.
Do not upload a zip as a replacement for the individual files.
Do not use base64 fallback.
Do not use thread attachment fallback.

## Evidence To Record

After upload, record:

1. visible Project Source file list showing all `260620_GEN2_SPLIT_*` files;
2. screenshot or exported text of the visible list;
3. confirmation that the files are Project Sources, not thread attachments;
4. the `files.sha256` content as local hash reference;
5. the impl-work thread URL after creation;
6. the impl-work readback response.

## Next Step After Upload

Create an impl-work Project thread using `prompts/IMPL_WORK_INITIAL_PROMPT.md`.
The first acceptable worker output is `GEN2_IMPL_WORK_READBACK.json` only.
Gen1 must review that readback before implementation continues.
