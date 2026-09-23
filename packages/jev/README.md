# Jev: Typed Judgment CLI

One-shot CLI for typed semantic answers via the Jev provider, invoked through envctl auth exec to inject JEV_API_KEY without exposing the secret to Windows.

## Build

```bash
nix build .#jev
```

## Invoke

```bash
printf '{"type":"noul","text":"A lamp is on.","question":"Is the lamp on?"}' | \
  envctl auth exec \
    -bundle "$ENVS_BUNDLE" \
    -environment local \
    -artifact "$PWD/result/share/jev/artifact.jsonl" \
    -sops "$SOPS" \
    -age-key-file "$AGE_KEY_FILE" \
    -- "$PWD/result/bin/jev"
```

## Input

```json
{"type":"noul","text":"<string>","question":"<string>"}
```

## Output

Success: `{"model":"<string>","noul":<number>}`  
Error: `{"error":"<code>","message":"<string>"}`

## Exit Codes

- `0`: success
- `1`: input/JSON error
- `2`: JEV_API_KEY missing (envctl did not inject)
- `3`: provider error
- `4`: contract error
- `5`: internal error

## Credentials

The envs bundle must authorize `jev-api` capability. Merging or installing the bundle alone gives no credential; only envctl's child process receives JEV_API_KEY in environment. The CLI reads only the environment variable, never argv or stdin.
