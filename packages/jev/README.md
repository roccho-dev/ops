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

**Direct jev exit codes:** `0` success, `1` input/JSON, `2` missing JEV_API_KEY, `3` provider, `4` contract, `5` internal.

**Through envctl auth exec:** For any nonzero jev exit, `envctl` returns exit `1` and prints `envctl: exit status N` on stderr while the jev JSON output remains on stdout. If `envctl` fails before the child starts, stdout is empty.

`envctl` injects `JEV_API_KEY` into the jev child process environment. The installed artifact requires `jev-api`; the selected envs environment must supply its binding. Installing or merging this package does not provision a credential. Pass no key in arguments or stdin.
