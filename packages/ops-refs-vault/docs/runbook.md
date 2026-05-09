# ops-refs-vault runbook

`ops-refs-vault` は、local の複数 repo を保ったまま、単一 remote repo に退避するための package です。

標準 remote は `roccho-dev/refs` です。

```text
local repos/* -> refs/heads/repos/<repoId>/<branch> in roccho-dev/refs
local tags    -> refs/tags/repos/<repoId>/<tag> only when requested
```

## 1. 1 repo を vault 用に設定する

```bash
ops-refs-vault adopt \
  --repo-id specs \
  --repo-dir /home/nixos/repos/specs \
  --remote git@github.com:roccho-dev/refs.git
```

`adopt` は remote/fetch/tag policy を設定します。local bare remote なら通常の
`git push refs-vault` で検証できます。

GitHub remote の場合、`adopt` は `remote.<name>.push` を設定しません。これは、
`git push refs-vault` が通常経路の GitHub push として実行される escape hatch を防ぐためです。
GitHub へ出す時は `ops-refs-vault push-all` を使います。`push-all` が各 refspec を
`ops-tailnet-github-egress push-local --long-transfer` に委譲します。

```bash
ops-refs-vault push-all \
  --manifest /path/to/refs-vault.manifest.json \
  --workspace /home/nixos/repos
```

この経路は `github.com` の全 IPv4 route が `tailscale0` であることを gate し、
`HostName=<route checked IPv4>` / `HostKeyAlias=github.com` / `ssh -4` /
`KexAlgorithms=curve25519-sha256` / `HostKeyAlgorithms=ssh-ed25519` を使います。
実 repo head のような non-tiny push は必ず `--long-transfer` を使います。

## 2. manifest に従ってまとめて push する

```bash
ops-refs-vault push-all \
  --manifest /path/to/refs-vault.manifest.json \
  --workspace /home/nixos/repos \
  --dry-run
```

問題なければ `--dry-run` を外します。remote が GitHub なら、`push-all` は各 refspec を
`ops-tailnet-github-egress push-local --long-transfer` に渡します。GitHub ではない local bare remote なら、
GitHub 不使用のまま `git push <local-remote> <refspec>` を使います。

```bash
ops-refs-vault push-all \
  --manifest /path/to/refs-vault.manifest.json \
  --workspace /home/nixos/repos
```

`push-all` は `repoId` ではなく manifest の `localPath` を見ます。
これにより、`repos/devtools` でも `custom/devtools-src` でも同じ `repoId=devtools` として扱えます。

## 3. exact branch を復元する

```bash
ops-refs-vault materialize \
  --manifest /path/to/refs-vault.manifest.json \
  --repo-id specs \
  --branch main \
  --dest /tmp/restored-specs
```

指定 branch がなければ失敗します。
勝手に `main` へ fallback しません。

## 4. remote を監査する

```bash
ops-refs-vault audit \
  --manifest /path/to/refs-vault.manifest.json \
  --remote git@github.com:roccho-dev/refs.git
```

## 5. local と remote の hash を照合する

```bash
ops-refs-vault verify-ref \
  --repo-dir /home/nixos/repos/specs \
  --remote git@github.com:roccho-dev/refs.git \
  --repo-id specs \
  --branch main
```

## 6. local bare remote で smoke する

```bash
ops-refs-vault smoke-local
```

この smoke は GitHub を使いません。
同じ branch 名と同じ tag 名が repoId namespace で衝突しないこと、exact restore、missing branch fail を確認します。

## 7. hot backup の限界

`roccho-dev/refs` は hot backup です。cold backup ではありません。
守れるのは commit 済みで remote へ push 済みの Git object だけです。
dirty / untracked / ignored / secret / build cache は Git push では保護されません。
release 保証が必要な時は、別途 bundle と signed manifest を作ります。
shallow repo は content shelter には使えても exact history backup ではありません。

## 8. default safety

- default は no-force です。force は `--force` を明示した時だけです。
- tags は default では push しません。`--push-tags` を明示した時だけ `refs/tags/repos/<repoId>/<tag>` へ出します。
- missing branch restore は default fail です。勝手に `main` や最初の branch へ fallback しません。
