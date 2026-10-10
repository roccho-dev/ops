# 既知Core選択の最小契約

Goalと各Coreの既存`when`から、apply / skip / unknownを選び、0..Nの選択集合にまとめる。既存のCore意味と評価器は変更しない。選択先の実行、採否、新しい能力の発見はこのsliceの責務ではない。

`cores/route.mjs`は用途名に依存せず、既存のModelPortで1組を判断する。`portable.mjs`で全組を評価する。結合部`route-run.mjs`だけが既存Coreのid/whenを集める。判定にGoldや問題IDを渡さない。

未解決のCoreがある場合は選択済みとunknown集合を両方返し、情報不足をskipや空の成功へ変換しない。全CoreがskipならNO_CATALOG_MATCHであり、そのGoalに必要な未知能力まで不要と主張しない。選択はCoreの並列実行ではない。

開発用8Goalと参照集合、モデル条件、Core実装、catalogの説明を実行前に固定する。各Goal×2Coreで最大16呼出し。入力資料をまだ評価できないことと、Goalの意味から必要な検査を選べないことを区別する。自動再試行しない。今回の問題と正解は同じ作成者の開発例であり、独立Gold/未使用Holdoutではない。

正答は16個の適用判定と8個の選択/unknown集合の両方で測る。機械検証と実推論品質は分けて記録し、独立検証の未達と新規能力発見・利用効果の未実証を残す。実行結果・source/run・会計はコメントと保存したreceiptで追えること。
