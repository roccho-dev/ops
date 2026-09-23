# Jev CLI

Ask Jev a question about text. The CLI reads one JSON request on stdin and writes one JSON line.

```sh
nix build .#jev
```

Set `ENVS_BUNDLE`, `SOPS` and `AGE_KEY_FILE` to absolute paths for the envs auth bundle, sops executable and age identity:

```sh
printf '%s\n' '{"type":"noul","text":"A lamp is on.","question":"Is the lamp on?"}' |
  envctl auth exec -bundle "$ENVS_BUNDLE" -environment local \
    -artifact "$PWD/result/share/jev/artifact.jsonl" \
    -sops "$SOPS" -age-key-file "$AGE_KEY_FILE" -- "$PWD/result/bin/jev"
```

Success: `{"model":"...","noul":0.99}` (`noul` in [0,1]); error: `{"error":"...","message":"..."}`.

**Direct jev exit codes:** 0 success, 1 input/JSON, 2 missing JEV_API_KEY, 3 provider, 4 contract, 5 internal.

**Through envctl auth exec:** If jev exits nonzero (1–5), `envctl` returns 1 and prints the actual jev exit code on stderr. The jev JSON output remains on stdout. jev source and behavior remain independent of envctl.

The installed artifact requires `jev-api`; the selected envs environment must supply its binding. Installing or merging this package does not provision a credential. Pass no key in arguments or stdin.
