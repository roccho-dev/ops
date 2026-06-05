# 破壊的ユースケース x100(意味的のみ・構造試験を含まない)

最終ゴール: **ops の py→node 移行を「意味的にデグレしない範囲」で確定する**。
各ケースは「ある入力/状況で、ツールの **目的(意味)** が py↔node で食い違って壊れる」シナリオ。
**構造的試験(ファイル存在・JSON が parse できる・check が緑・package が build できる 等)は一切含めない。**

判定原則: ある package が、自分に該当する全ケースで **py と意味的に同値** を実証できれば node 採用。
node に無い battery を自前実装して同値を担保できないケースが残れば、その package は **py 据え置き=proposal から除外**(`runtime:"python"` で jsonl-build に残し、.mjs を撤回)。

凡例(意味クラス): A=同一性/ハッシュ B=エンコーディング C=正準順序 D=CLI契約 E=数値精度
F=再現性/冪等 G=構文解析(csv/regex) H=FS/パス I=プロセス J=時刻 K=状態機械判定 L=ツール間契約 M=異常系

---

## ops-knowledge-intake(csv / json ensure_ascii / Counter / dedup / 採番)
1. 知見フィールドに日本語 → summary JSON が py(`\uXXXX`)と node(生UTF-8)で別表現になり、ASCII前提の差分照合/重複判定が同一知見を別物と誤認 [B,A]
2. フィールド値に埋め込みタブ → node の素朴 split が列ずれを起こし、knowledge_id が誤フィールドから生成され重複排除が破綻 [G,A]
3. 引用符で囲んだ改行を含む値 → py csv は1レコード、node は複数行に分裂し件数(count)が変わる [G,M]
4. 同一 (kind,applies_to,evidence_paths) の重複入力 → 正規化差で py 1件 / node 2件 [A,C]
5. evidence_paths が同集合・別順序 → dedup キー(JSON.stringify vs json.dumps)が一致せず重複を見逃す [A,C]
6. knowledge_id 連番採番が、入力の安定ソート差で py と node で別 ID → 既存参照が断絶 [C,A]
7. 末尾改行/空行の扱い差 → py は最終空行無視、node が空レコードを生み count+1 [G,M]
8. Counter.most_common の同数タイ順 → 順位が変わり知見の優先度提示が誤る [C]
9. 非ASCII を含む kind の slug 化差 → knowledge_id が別物になり横断参照が切れる [B,A]

## ops-handoff-core(sort_keys / 既定 ensure_ascii / hashlib / datetime / ツール間契約)
10. payload に日本語 → sha256 を `json.dumps(sort_keys).encode()` 上で計算。escaper が1byteでも違えば完全性ハッシュ不一致で取込側が改竄扱い拒否 [A,B,L]
11. payload の bytes 長(`len(...encode())`)が escape 方針差で py/node 相違 → サイズ契約メタ不整合 [E,B]
12. 多階層・多キーの scope → sort_keys 再帰ソート差で manifest 文字列が変わり再生成のたび diff(冪等喪失) [C,F]
13. 生成(py)→取込(node)混在運用 → ハッシュ表現差で round-trip 不能 [L,A]
14. `datetime.now(utc).isoformat()` が py「+00:00」/ node「Z」→ handoff タイムスタンプ照合・順序が壊れる [J]
15. claim 追記時の sort_keys 差 → 既存行と異なる正規化で後続の重複検出が誤動作 [C,A]
16. scope に絵文字(サロゲートペア)→ escaper のサロゲート分解が py と不一致で表示・ハッシュ破綻 [B,A]

## ops-artifact-materialize(base64 / hashlib / json 既定 / re / 冪等)
17. artifact 本文が非ASCII → 復元後の内容ハッシュ照合が encode 差で不一致、改竄誤検知 [A,B]
18. base64 に改行/パディング変種 → py base64 と node Buffer の寛容度差で復元成否が分かれる [G,M]
19. 同一スレッドを2回 materialize → manifest の ok/ハッシュが冪等でなく再実行で別結果 [F,A]
20. `--strict-count` 対象が非ASCII → 抽出 re の `\w` ユニコード差でカウントずれ strict-count 誤判定 [G,B]
21. 本文の CRLF → py 保持 / node 正規化で内容ハッシュ不一致 [B,A]
22. 抽出 regex が `re.DOTALL/MULTILINE` 依存 → node フラグ差で artifact 境界の切出しが変わり内容欠落 [G]

## ops-src-runtime-pack(tarfile / gzip / hashlib / sort_keys / subprocess)
23. 同一 source を2回 pack → gzip header の mtime/OS バイトで bytes が変わり「同入力同成果」契約破綻 [F]
24. 自前 USTAR の checksum/mode(octal)実装差 → py tarfile 生成物と展開互換が崩れ消費側 tar が破損判定 [E,L]
25. ファイル名 100byte 超 → py tarfile は longname 拡張、node 自前が切詰め/失敗で中身欠落 [G,M]
26. 非ASCII ファイル名 → tar header name エンコード差で展開時に別名・文字化け [B,L]
27. シンボリックリンク/実行ビット → typeflag/mode の扱い差で復元実行環境の意味が変わる [H,E]
28. pack 内容ハッシュ(sha256 over tar)→ tar byte 差で毎回ハッシュ変動、署名・検証が無意味化 [A,F]
29. 空ディレクトリ/0byte ファイル → py は記録、node 自前が欠落させ source 再現が不完全 [M,H]
30. ファイル列挙順 → py sorted / node readdir が OS 依存で tar 内順序が非決定化(再現性喪失) [C,F]
31. mtime 非ゼロ正規化 → ビルドのたび pack が変わり nix 入力ハッシュが揺れる [F,J]

## ops-thread-fsm(状態機械判定 / json ensure_ascii=False)
32. 非ASCII を含むスレッド状態 → classify が node で同一決定(decision 不変)を返すか [K,B]
33. plan-accepted 等の遷移境界 → next_action_for/permissions_for が py と同一の許可集合(権限誤付与は重大) [K]
34. readback 値の正規化(空白/大小/全角)→ classify_readback_value の差で readiness を誤ゲート [K,G]
35. discussion「異議なし」判定 → 文字列照合の正規化差で no-objections を誤確定/誤却下 [K,B]
36. evidence の delivery_manifest_ok → ファイルの意味判定が py と一致するか [K,L]
37. plan review blockers 評価 → 同一入力で同一の blocker 集合を返すか [K,M]
38. 状態 kind の canonical 化 → 未知/別名 kind の正規化差で遷移先が変わる [K,M]

## package-architecture-map(re / sort_keys / mermaid 生成 / shutil)
39. 非ASCII ノード名 → 生成 mermaid のラベル表現/エスケープ差でノード同定の意味が変わる [B,G]
40. validate-only の不正エッジ検出 → 未知ノード参照の判定(ok:false)・メッセージが同一か [M,L]
41. 同一 inventory → latest.mmd が冪等生成されるか(順序/sort 差で毎回 diff) [C,F]
42. ノード名に mermaid 特殊文字(引用符/改行/[])→ エスケープ差で図が壊れる/別構造 [G]
43. エッジの安定ソート → 同集合で順序非決定だと図 diff ノイズでレビュー破綻 [C]

## ops-runbook-checks(json 既定 / report の意味)
44. runbook 検査の合否 → 同一入力で py/node が同じ pass/fail(誤合格は重大) [K,M]
45. 非ASCII を含む runbook → report JSON の表現差で下流集計が壊れる [B]
46. 複数チェック項目の順序 → 非決定だと差分運用が壊れる [C]
47. 欠落フィールド/部分入力 → py の警告/エラーの意味を node が再現するか [M]

## ops-refs-vault(subprocess array / git push 意味 / tempfile / isLocalBare)
48. vault がローカル bare → isLocalBare 判定(HEAD/objects 存在)の意味が一致、誤判定で push 方式誤選択 [K,H]
49. ls-remote で同一 ref が複数一致 → py は例外停止 / node が黙って1件選ぶと誤 sha を vault 化 [M,A]
50. force push の意味 → refspec(`+`前置)構築差で意図せぬ上書き/拒否 [M,L]
51. ref 名に特殊文字 → subprocess(array)で shell 非経由を保ち誤実行しないか [I]
52. 一時 worktree 経由 push → クリーンアップ漏れ/衝突で2回目失敗(冪等性) [F,H]
53. push 先到達不可 → exit code/メッセージの意味伝播が一致(CI 判定) [I,M]
54. smoke-local の各 proof(P01..P11)→ 各 proof が表す検証の合否が py と同一か [K,L]

## ops-tailnet-github-egress / git-push-tailnet(argparse / socket / subprocess / shlex)
55. argparse 省略形(`--rep`→`--repo`)→ py 受理 / node 拒否で既存呼出スクリプト破綻 [D]
56. 不正サブコマンド → py の usage+「choose from」+exit2 を node が再現しないと CI の grep/exit 依存が壊れる [D,M]
57. policy --json の意味(connectorTag/route-gated)→ 出力の意味値が py と一致するか [L]
58. 非 GitHub remote 判定 → push 拒否の意味判定が同一(誤って外部 push は重大事故) [K,M]
59. shlex.quote で組むコマンド → 特殊文字引数の quoting 差で誤コマンド実行/route 漏れ [I]
60. socket のルート/IP 選択(--print-selected-ip)→ 選択 IP の意味が一致(誤 route は egress 漏れ) [K,I]

## prove-feat(argparse / sort_keys / re / subprocess)— infra ゲート
61. gate 合否(structure/format/deadnix/contract-lint)→ 同一 root で py/node が同一 ok(誤合格でゲート無意味化) [K,M]
62. contract-lint の implements.json 解釈 → 宣言 output と実 flake の突合判定が同一か [L,M]
63. report の sort_keys → 冪等で CI 差分が出ないか [C,F]
64. subprocess(nix/git 呼出)→ 失敗時の意味伝播・タイムアウト挙動が一致 [I]

---

# 横断クラス(全 node 化 package に適用)

## エンコーディング/JSON 直列化
65. 既定 ensure_ascii=True を採っていたツールが node で生 UTF-8 を出す → ASCII 前提の grep/監視が無反応(サイレント劣化) [B,L]
66. ensure_ascii=False 意図のツールで node が誤って escape する逆方向の差 → 日本語ラベルが `\uXXXX` 化し可読性・契約破綻 [B]
67. サロゲートペア(絵文字)の `\u` 分解差 → 1文字が別表現になりハッシュ/同定崩れ [B,A]
68. 大整数 → py 任意精度 int / node Number で 2^53 超が丸められ bytes/カウント/ID 破損 [E]
69. NaN/Infinity → py 出力(or 例外)/ node null 化で意味が変わる [E,M]
70. 入力 JSON のキー重複 → last-wins 解釈差で値が変わる [M]
71. 浮動小数の文字列化(repr 差)→ manifest 値不一致 [E]

## 時刻/ロケール(datetime 使用)
72. TZ付き ISO「+00:00」vs「Z」→ 横断タイムスタンプ照合・ソート破綻 [J,C]
73. マイクロ秒(py 6桁)vs ミリ秒(node 3桁)→ 精度差で順序・一意性が変わる [J,E]
74. ローカルタイム混入 → UTC 固定を破ると環境依存で値が揺れ再現性喪失 [J,F]

## 正規表現方言(re 使用)
75. `\d`/`\w` がユニコード対象(py)か ASCII(node 既定)か → 全角数字・日本語語境界で抽出が変わる [G,B]
76. lookbehind `(?<=…)`/名前付きグループ構文差 → パターン不一致で抽出が無言で空振り [G]
77. `re.MULTILINE` の `^$` 挙動差 → 複数行マッチがずれる [G]
78. 貪欲/最小マッチ・後方参照 → 同パターンで別範囲を切り出す [G]

## プロセス/subprocess(subprocess 使用)
79. 引数に空白/メタ文字 → py subprocess(list)=shell 非経由。node も spawn(array)である保証(string concat/shell:true 混入は誤実行) [I]
80. 環境変数/cwd の引き継ぎ → 子プロセスの文脈が py と一致するか [I]
81. stdout/stderr 分離と exit code → 失敗(非0)を正しく伝播し呼出側の分岐を保つ [I,M]

## ファイルシステム(shutil/pathlib/tempfile 使用)
82. 出力 dir への上書き vs マージ → rmtree/copytree の意味を再現(残骸混入は成果汚染) [H,M]
83. アトミック書込(tmp→rename)→ 中断時の半端ファイル防止の意味が保たれるか [H,F]
84. パス正規化(`..`/`//`/symlink)→ py pathlib と node path の解決差で別ファイルを読書き [H]
85. 権限/実行ビット保持 → 復元環境の実行可能性の意味が変わらないか [H,E]

## 冪等性/決定性(全ツール)
86. 「同一入力 2回 = 同一出力 byte」→ どれかが非決定(順序/時刻/temp名混入)だと nix 純粋性・cache が壊れる [F,C]
87. 並行実行時の temp 衝突 → 固定 temp 名だと同時2実行が干渉(意味的破壊) [F,H]

## 異常系(全ツール)
88. 空入力/0レコード → py の挙動(空成果 or エラー)を node が同義に再現 [M]
89. 不正/壊れ入力 → py の例外メッセージ/exit の意味を node が保ち呼出側の分岐を維持 [M,I]
90. 巨大入力(境界)→ 失敗の仕方が破壊的でない(部分成果の汚染なし) [M,F]
91. append-only ログの重複/矛盾イベント → fold の last-wins 意味が py/node で一致 [M,A]

## CLI 契約(argparse 全ツール)
92. 必須引数欠落 → exit code と usage の意味が呼出契約と一致 [D]
93. 型強制(int/path)→ 不正値で py のエラーを node が同義に出す(黙って 0 等にしない) [D,E]
94. デフォルト値の意味 → 省略時の既定が py と一致 [D]
95. `--json` と人間可読の切替 → 両モードで意味的同値の情報を返す [D,L]

## 数値/集計の意味(集計するツール)
96. パーセンテージ/丸めの方式(banker's rounding 等)→ py round と node の丸め差で集計値が変わる [E]
97. ソート安定性 → 同キー要素の相対順が py(安定)と node(実装依存)で食い違い出力順が変わる [C]

## ツール間契約(A の出力を B が消費)
98. manifest schema の意味(必須キー・型)→ 生成側 node が py と同じ意味の manifest を出し消費側が解釈できるか [L]
99. ハッシュ/ID をまたいだ整合 → ツール間で同一アルゴリズム・同一正規化を使い ID が一致するか [A,L]
100. 人手運用の前提(出力を grep/目視する慣行)→ 表現が変わって既存運用手順が黙って通らなくなっていないか [L,B]

---

## 実証検証 → tree 状態(完成系の定義)
- 各 package につき、該当ケースを **旧 .py(git 復元)と新 .mjs で同一入力実行 → 意味的同値を実証**(ハッシュ/manifest/decision/順序/エンコード)。
- **同値を担保できないケースが残り、その根が「node に無い battery の自前実装」(主に tarfile / csv)** の package は **py 据え置き=proposal から除外**(`runtime:"python"` で jsonl-build に残し .mjs 撤回)。
- 修正可能な差(re 方言・ensure_ascii・ISO 時刻 等)は node を **直して再実証**。
- 完成系 = 「上記 100 ケースが該当 package で実証検証され、node 群は意味的同値・py 据え置き群は明示分離された tree」。
