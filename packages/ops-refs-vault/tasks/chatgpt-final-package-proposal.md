# ChatGPT task: propose the final ops-refs-vault package shape

あなたは設計レビュー担当です。
目的は、`ops-refs-vault` の最終形を提案することです。

## 背景

local には複数 Git repo がある。
remote forge は `roccho-dev/refs` の 1 repo に集約したい。
各 local repo/branch は remote で次の namespace に保存する。

```text
refs/heads/repos/<repoId>/<branch>
refs/tags/repos/<repoId>/<tag>
```

GitHub 通信そのものは `ops-tailnet-github-egress` が扱う。
`ops-refs-vault` は ref layout、manifest、restore、shelter、検証を扱う。

## 既に分かっていること

- local repo は複数のままにする。
- package を単一 monorepo に潰さない。
- `repoId` は remote namespace を決める。
- `localPath` は local 配置を決める。
- 同じ branch 名や tag 名は repoId namespace で衝突しない。
- missing branch restore は default fail にする。
- dirty/untracked/ignored/secret/build cache は Git push では守れない。
- shallow repo は exact history backup ではない。
- shelter push は no-force が標準。
- GitHub push は route-gated local push または long-transfer 経由にする。

## 提案してほしいこと

1. 最終 package 名、責務、境界。
2. manifest schema。
3. CLI command set。
4. docs 配置。
5. acceptance tests。
6. shelter/quarantine/canonical namespace の命名規則。
7. GitHub/App Connector 境界。
8. 既存文化を無視する内部 hot backup と、将来の配布 remote の分離。
9. 今すぐ実装するべきもの、後でよいもの。
10. この案への異論、失われるもの、代案。

## 出力形式

次の見出しで答えてください。

```text
1. Final proposal
2. Manifest schema
3. CLI commands
4. Docs and tasks
5. Acceptance tests
6. Migration plan
7. Risks and objections
8. Alternatives rejected
9. Next concrete edits
```

結論だけでなく、なぜそうするかも短く書いてください。
