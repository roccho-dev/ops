# shelter push runbook

shelter push は、未統合の local repo/branch を一度 `roccho-dev/refs` に退避させる運用です。

## 原則

- default は no-force です。
- 既存 canonical ref と local HEAD が違う時は、上書きせず shelter namespace を使います。
- dirty/untracked は Git push では守れません。
- detached HEAD は通常 branch として扱いません。
- shallow repo は exact history backup ではありません。

## 推奨 namespace

```text
refs/heads/repos/<repoId>/<branch>
refs/heads/shelter/<runId>/repos/<repoId>/<branch>
refs/heads/quarantine/<runId>/<localName>/<branch>
```

## inventory

先に inventory を取ります。

```bash
ops-refs-vault inventory \
  --manifest refs-vault.manifest.json \
  --workspace /home/nixos/repos \
  --out-dir /tmp/refs-vault-inventory
```

出力:

```text
inventory.tsv
push-plan.tsv
```

## 現時点で script 化済みの範囲

- manifest repo の状態確認
- clean/detached/dirty/missing の分類
- no-force の基本 push
- remote hash 照合

## まだ task の範囲

- canonical ref と local HEAD が違う時の shelter namespace 自動選択
- unknown mapping repo の quarantine 自動選択
- shallow repo の snapshot 作成と history backup の明示分離
- `.worktrees/*` の production inventory policy
- proof repo と `cdp-ops-poc` temp repo の除外規則
