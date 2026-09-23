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

Success: `{"model":"...","noul":0.99}` (`noul` in [0,1]); error: `{"error":"...","message":"..."}`. Exit codes: 0 success, 1 input, 2 missing key, 3 provider, 4 contract, 5 internal.

The installed artifact requires `jev-api`; the selected envs environment must supply its binding. `envctl` injects `JEV_API_KEY` into the CLI child process. Installing or merging this package does not provision a credential. Pass no key in arguments or stdin.
