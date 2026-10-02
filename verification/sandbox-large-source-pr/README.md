# Sandbox large multi-file source transport fixture

A normal ESM regression fixture developed in the current sandbox. It contains 32 importable source modules, exactly 2 MiB across the modules, plus an index, CLI, manifest, and tests. The repeated policy documentation intentionally makes the exact source compressible; GitHub receives the compressed bytes and must reconstruct the files without seed generation or model repair.
