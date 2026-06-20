# Manual Project Source Upload Kit 260620

This kit is continuation evidence for the Project Source transport gate. It is
not completion proof and not semantic approval.

Gen1 reviewed the local kit as PASS with one caveat: if ChatGPT Project Source
flattens nested filenames such as `output-contract/...`, the transport actor may
adjust only the short control prompt to reference the exact visible filename.
The uploaded file contents and fixed revisioned files must not be rewritten.

## Required Post-upload Evidence

Before impl-work proceeds, record:

- Project URL and Project name visible: `remove-policy`
- Project Source page visible, not thread attachment UI
- all 13 expected files visible as Project Sources
- exact visible names as ChatGPT shows them
- local `files.sha256` preserved as hash reference
- screenshot or text snapshot of Project Source inventory
- whether `output-contract/` path was preserved or flattened
- impl-work thread URL
- exact initial prompt sent, unchanged except visible filename adjustment if needed
- first Gen2 response as `GEN2_IMPL_WORK_READBACK.json`

Gen1 must review the readback before any impl-work output is accepted.
