# 完成系 spec — ops: node-only + jsonl-build(Agent 契約)

gen0 はレビュー専従。Agent はこの spec に向けて実装する。**main へ FF しない**(成果は `claude-proposed` 配下の作業ブランチ→`claude-proposed` へ統合)。

## 2 目的
1. **node-only**: ops の全 package の logic を node(.mjs)に。`.py` / `qjs:` import / `.zig` を logic 層からゼロに。
2. **jsonl-build**: 全 package/check を `build/*.jsonl` の宣言から **生成**する(flake.nix は汎用インタプリタ=一度だけ書く nix。package 追加 = jsonl 1行 + .mjs、nix 手書きしない)。

## 完成系 tree
```
ops/
├ flake.nix            ★汎用インタプリタ(build/*.jsonl を fold→packages/checks)
├ build/
│  ├ runtime.jsonl     {"kind":"runtime","id":"node","from":"nodejs26"}
│  ├ packages.jsonl    1行=1package(下記スキーマ, append-only)
│  └ checks.jsonl      1行=1check
├ packages/<each>/     logic は .mjs のみ(bin/*.mjs, lib/*.mjs)。.py 廃止
└ docs/ spec/ issues/
```

## build スキーマ
```jsonc
// build/packages.jsonl
{"kind":"package","name":"<n>","runtime":"node","entry":"packages/<n>/bin/<n>.mjs","bin":"<n>","deps":["git"],"env":[{"name":"X","value":"..."}]}
// build/checks.jsonl
{"kind":"check","name":"<n>","script":"packages/<n>/tests/check.mjs","deps":["<n>"]}
// build/runtime.jsonl
{"kind":"runtime","id":"node","from":"nodejs26"}
```
flake.nix: `build/*.jsonl` を読み(pure-eval, readFile+fromJSON)、
- package = `pkgs.writeShellApplication { name=bin; runtimeInputs=[nodeRuntime]++(map nixpkg deps); text=''<env export>; exec node ${entry} "$@"''; }`
- check = `pkgs.runCommand "<n>-check" { nativeBuildInputs=[<deps packages>]; } ''<assert; node ...>''`
- ops-cdp-core は既存 chromium-cdp.nix(node 済)を取り込む特例として残してよい。

## 変換ルール(.py→.mjs, 1 package ずつ)
- `bin/<n>.py` の挙動を **同値**で `bin/<n>.mjs`(node, ESM, stdlib のみ: fs/path/process/child_process)へ移植。argparse→ 手書き/`util.parseArgs`、json→ JSON、subprocess→ child_process、re→ RegExp(方言差注意)。
- 日本語/encoding は utf8 明示、整数は必要なら BigInt(精度)。未await/unhandledRejection→非0 exit を入れる。
- flake.nix の当該 package を python3→node に(最終的には build/packages.jsonl 駆動へ)。

## ★実証試験(必須・コード変更だけの報告は無価値)
Agent は「node へ書き換えた」だけでは**報告に値しない**。以下の**実証**を Agent 自身が行い、**具体的証拠**を報告に含めること:
1. **挙動同値の実証(.py 削除前に)**: 旧 `.py` と新 `.mjs` を**同一入力**(その check のテスト入力 + 代表ケース)で実行し、**stdout / 出力ファイルが byte 同値**であることを `diff` で示す(差分ゼロ)。.py を既に消した場合は `git show HEAD:<path>.py` で復元して比較。→ 「同値である」証拠(diff 結果)を報告。
2. **check 緑の実証**: `nix build …#checks.x86_64-linux.<n>` を実走し exit 0 + **store path** を報告。
3. 上記2つの**証拠が無い報告は却下**(gen0 は独立に再実行して突合する)。挙動が違えば STOP し差分を報告。

## 受け入れ gate(gen0 がレビューで突合)
1. `grep -r 'exec .*python3' flake.nix` = 0、logic 層に `*.py`/`qjs:`/`*.zig` = 0。
2. 全 package/check が build/*.jsonl の fold で生成(flake.nix に per-package 手書き derivation なし)。
3. `nix flake check`(path:claude-proposed)= **全 green**(各 package の挙動同値 check 含む)。
4. **`nix build .#packages.x86_64-linux.nodejs26` 実ビルド成功**(eval だけ不可。DC-N-03)。
5. **purity check**(checks に常設): logic 層の `.py`/`qjs:`/`.zig`/`python3` を検出したら fail。
6. append-only(build/*.jsonl, defs.jsonl)/ packages・checks のみ(apps/devShells 無)/ KISS・DRY・SOLID・YAGNI。

## 進め方
- Phase A(並列, package 毎): .py→.mjs + 当該 check green。
- Phase B: flake.nix 汎用インタプリタ化 + build/*.jsonl 整備(全 package を jsonl 駆動へ)。
- Phase C: purity check 常設 + nodejs26 実ビルド検証。
- 各 Agent DoD = 担当分の gate 充足。gen0 が diff/`nix flake check`/purity/挙動同値をレビューし赤は差し戻し。
