# ops PoC — jsonl → nix output(package only) → ops consume の自己完結証明

adrs proposal `raw-20260604-ops-jsonl-nix-selfcontained` の proof。
**ops 本体 flake に統合**(`.dev/` は使わない。ops の慣習どおり `packages/` + ルート `flake.nix`)。

## 主張
ops 内で、**jsonl を唯一の入力**として **nix output を package のみ**で生成し、その output を **同 ops の本体 flake が consume** して**閉路が外部 input なしに成立**することを示す(横の sub-flake ではなく ops 本体で完結)。

## 構成(閉路) — すべて ops ルート flake.nix
```
packages/ops-selfcontained-poc/data.jsonl
   ──(jq fold)──> packages.<sys>.poc-from-jsonl ($out/result.json)
                         │ consume
                         ▼
                  checks.<sys>.poc-consumes  (jsonl由来と一致を検証)
```

## 証明コマンド
```sh
nix build .#checks.x86_64-linux.poc-consumes
# 緑 = 外部 input なしで jsonl→package→consume の閉路が成立(完結)
```

## 4原則(徹底)
- **KISS**: 最小 flake、変換は jq の一段 fold のみ。
- **DRY**: `data.jsonl` が単一データソース。
- **SOLID**: `poc-from-jsonl`=生成、`poc-consumes`=検証 の単一責務に分離。
- **YAGNI**: パラメタ化・追加 output 等の汎用化はしない。

## 制約遵守
- output は **packages / checks のみ**(apps・devShells を出さない=specs `outputReviewGate` 整合)。
- `data.jsonl` は **immutable / append-only**。
