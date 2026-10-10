# 継続：独立確認の受入れ・再開・Core追加

親の期待は[ops#523](https://github.com/roccho-org/ops/issues/523)、交換境界は[#524](https://github.com/roccho-org/ops/issues/524)。本sliceは固定候補・採点の既存証拠を変えず、P3/P4の準備とP5の2用途接続を進める。

`portable.mjs`はCore.run(input,ModelPort)を実行して固定Goldで照合する。モデル・Core名・HTTP・認証を知らない。用途の結合はrun.mjsの宣言リストにのみ置く。Issue Coreは凍結済みE/Oの問いと写像を再利用し、Jev固有処理はmodels/jev.mjsへ分離する。対応primitiveはこのsliceではwhichのみ。

Dirtree Coreは責務重複の一軸・指定2要素に限定する。単一の美しさ総合点、全テーマ品質、全graphの未知問題発見を主張しない。両Coreの開発問題は各8件。Issueの2件は宣言された入力から決定的に処理し、モデル評価したケースと区別する。

`progress.mjs`のreserve→settleをGit head比較交換で永続化する。予約中・中断時は最大消費を保持し、同じ予約の再通知はdispatch=false、古い結果・矛盾する結果は拒否する。新しいDBやqueueを要求しない。純粋関数の試験と本物の無人実行一周は別の証拠である。

P3のholdoutIntakeは具体問題やGoldを読み込まず、次のmanifestだけを検査する：packageId/candidateDigest、独立authorとreviewerのidentityとreceipt、sealedなprivateArtifactのlocator/digest、population/count、criteriaのdigestと事前固定receipt、exposureの閲覧・未使用履歴。rolesを変えるだけで独立性としない。項目が揃ってもREADY_FOR_INDEPENDENT_VERIFICATIONであり、独立性やP3の品質合格は証明しない。具体的なcases/gold/answers/questionsをoptimizer用manifestへ混ぜない。非公開artifactそのもののACLや事実の検査は独立評価担当が行う。

受入れには第3引数として、呼出側が先に固定した `candidateDigest` と `criteriaDigest` を渡す。提出manifest自身から期待値をコピーして一致を作らない。候補・評価基準はSHA256形式と完全一致を要求し、未指定・不一致なら準備完了にしない。optimizerとauthor/reviewerの識別子は前後空白のない明示値を使う。metadataの最上位と各入れ子は許可フィールドに限定する。余分なフィールドは値を出力せず拒否する。この構造検査は、許可された文字列へ実内容が偽装されないことや、参照先の独立性・ACLを証明するものではない。担当の受諾と実在の確認を省かない。

独立Goldと未使用課題の準備を待つ間も、P4/P5の前提が揃う仕事を続ける。作業担当は実体・受諾済み担当・参照を確認し、資料にないだけで存在しないと断言しない。費用は記録するが担当が置いた旧80をユーザーの全体予算へ取り違えない。

実行記録はIssue/PRコメントとexact CI、会計はstate.json。消費と追加許可は既存の記録から読み、過去の試行上限を新しい工程の全体停止条件にしない。構造検査・接続・独立品質・無人再開・P6全体の完成をそれぞれ別の証拠として扱い、未完の段階を完了に昇格しない。
