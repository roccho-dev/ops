# Jev: Typed Judgment CLI

Ask a question about text and receive a typed semantic answer via the Jev provider, invoked through envctl auth exec.

## Build

```bash
nix build .#jev
```

## Run

```bash
printf '{"type":"noul","text":"A lamp is on.","question":"Is the lamp on?"}' | \
  envctl auth exec \
    -bundle <path> \
    -environment local \
    -artifact <path> \
    -sops <path> \
    -age-key-file <path> \
    -- <path>/result/bin/jev
```

Where:
- `-bundle`: absolute path to envs bundle (must declare jev-api capability)
- `-artifact`: absolute path to installed artifact.jsonl
- `-sops`: absolute path to sops executable
- `-age-key-file`: absolute path to age identity file
- `--`: child jev binary path

## Input

One JSON object on stdin:
```json
{"type":"noul","text":"<string>","question":"<string>"}
```

## Output

Exactly one JSON line:
- Success: `{"model":"<string>","noul":<number>}` where noul ∈ [0,1]
- Error: `{"error":"<code>","message":"<string>"}`

## Exit Codes

- 0: success
- 1: input/JSON error
- 2: JEV_API_KEY missing
- 3: provider error
- 4: contract error
- 5: fatal error

## Credentials

The Jev package declares the jev-api capability in its artifact.jsonl. Only the selected envs environment binding for jev-api provides the credential. Installing or merging the ops package alone does not supply credentials; only the child process environment configured by envctl auth exec receives JEV_API_KEY. The CLI reads the environment variable only, never stdin, argv, or output.
