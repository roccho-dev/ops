# ops-build-defs — append-only jsonl → nix snapshot/module(分離可能 package)

adrs `raw-20260604-ops-jsonl-nix-selfcontained` の発展。**build に必要な宣言(nixpkg attr / hash 等)を
append-only jsonl で持ち、nix が読み取り・選別(昇格)して snapshot/nix module 化**する。ops はこれを
consume して build する。**ops から分離可能**(独立 flake)。

## 仕組み(pure-eval, IFD なし)
```
defs.jsonl(append-only)
  ──(builtins.readFile + fromJSON 各行)──> records
  ──(nix 側で kind 選別=昇格)──> lib.snapshot { nixpkgAttrs, hashes, … }   ← nix module
                                   ├ packages.snapshot   (snapshot.json materialize=実体package)
                                   └ packages.tools-env  (選別 nixpkg を集約)
```
- **nix 側で選別**: `byKind "nixpkg"` 等。ビルドに必要な情報だけを snapshot へ昇格。
- output は packages のみ(apps/devShells なし)。jsonl は immutable/append-only。

## ops からの consume(ops ルート flake)
```nix
inputs.ops-build-defs.url = "path:./packages/ops-build-defs";   # 分離時は ssh://…/ops-build-defs.git に差替
# ops は ops-build-defs.lib.snapshot(nix module)を pure-eval で参照して build
```

## 動的可変性(証明済)
- **in-repo(現状)**: `defs.jsonl` に1行 append → 再 build で ops の成果物が即変化(相対 path input は narHash 非 pin=常に現 tree)。
  - 実証: `jq,coreutils` → `hello` append → tools-env 変化 → `which` append → ops-tools-from-defs に which 出現。
- **分離後(own repo 化)**: ops の input が narHash で locked となり、**flake.lock = snapshot**。
  `nix flake update ops-build-defs` が「再 snapshot」= 宣言的仕様への制御された動的変更。

## 証明コマンド
```sh
nix eval  path:.#lib.snapshot                         # nix module(選別結果)
nix build path:.#packages.x86_64-linux.snapshot       # snapshot.json
nix build path:.#packages.x86_64-linux.tools-env      # 選別 nixpkg 集約
# ops ルートから: nix build <ops>#packages.x86_64-linux.ops-tools-from-defs
```

## TODO(adrs)
理想: adrs repo の jsonl から「必要な jsonl だけ」import して構築。当面 ops 内で完結(cross-repo は保留)。
