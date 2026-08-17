# Runbook: Repo Head Carrier の取得・復元

`ops` の default branch 最新 HEAD を、過去履歴を持たない **1-commit shallow Git repository** として取得・検証する単一入口。

この runbook の identity は常に **40桁 full commit SHA**。`latest`、branch 名、Release 作成時刻、Actions artifact ID は identity にしない。

## 公開契約

`proposals` への push ごとに `.github/workflows/repo-head-materialize-proof.yml` がその時点の default branch HEAD を exact に解決し、次の Release を公開する。

```text
Tag: repo-head-<HEAD>

<HEAD>.git.tar.gz
<HEAD>.git.tar.gz.b64.txt
<HEAD>.receipt.json
```

- `<HEAD>.git.tar.gz`: `.git/` のみを含む depth=1 capsule。worktree は含めない。
- `<HEAD>.git.tar.gz.b64.txt`: 上記 archive の **標準 Base64 / padding あり / 改行なし** Carrier。
- `<HEAD>.receipt.json`: HEAD、tree、branch、容量、SHA-256、Carrier codec、shallow/commit-count、Release tag を固定する receipt。
- production Release は `prerelease=false`。proof branch の run は `repo-head-proof-<HEAD>-<RUN_ID>` の prerelease。
- workflow は公開後、Release の3 assetを public URL から再取得して元bytesと `cmp` し、Carrierからrepositoryを再構築して Git 検査まで通った場合だけ成功する。
- raw capsule は同時に Actions artifact `repo-head-<HEAD>` として30日保存される。Artifactは一時transportでありAuthorityではない。

## 必要コマンド

Linux環境で次を使用する。

```text
curl
python3
git
tar
sha256sum
```

## 1. HEADを確定する

依頼や上位manifestから40桁SHAを受け取れる場合は、それをそのまま `HEAD` とする。これが推奨経路。

現在のdefault HEADを自分で発見する必要があり、GitHub public Gitへ到達できる場合だけ次を使う。

```sh
HEAD="$(git ls-remote https://github.com/roccho-dev/ops.git refs/heads/proposals | awk 'NR==1 {print $1}')"
test "${#HEAD}" -eq 40
```

ここで得た値は discovery 結果であり、以降は必ずその full SHA に固定する。処理途中で `proposals` が進んでも、別HEADへ追随しない。

## 2. immutable-by-name URLを組み立てる

```sh
OWNER=roccho-dev
REPO=ops
TAG="repo-head-$HEAD"
BASE="https://github.com/$OWNER/$REPO/releases/download/$TAG"
RECEIPT="$HEAD.receipt.json"
CARRIER="$HEAD.git.tar.gz.b64.txt"
ARCHIVE="$HEAD.git.tar.gz"
```

`repo-head-latest` のような mutable tag は使わない。

## 3. receiptを先に取得・検査する

```sh
set -euo pipefail
rm -rf repo-head-restore
mkdir -p repo-head-restore/download repo-head-restore/repo
cd repo-head-restore

curl -fL --retry 5 --retry-all-errors "$BASE/$RECEIPT" -o "download/$RECEIPT"
```

receiptの構造を実行前に検査する。

```sh
python3 - "download/$RECEIPT" "$HEAD" <<'PY'
import json, re, sys
p, expected = sys.argv[1:]
x = json.load(open(p, encoding="utf-8"))
assert x["schema"] == "repo-head-release/1"
assert x["status"] == "PASS"
assert re.fullmatch(r"[0-9a-f]{40}", expected)
assert x["id"] == x["head"] == expected
assert x["source_repo"] == "roccho-dev/ops"
assert x["default_branch"] == "proposals"
assert x["shallow"] is True
assert x["commit_count"] == 1
assert x["release"]["tag"] == "repo-head-" + expected
assert x["release"]["prerelease"] is False
assert x["archive"]["name"] == expected + ".git.tar.gz"
assert x["carrier"]["name"] == expected + ".git.tar.gz.b64.txt"
assert x["carrier"]["codec"] == "standard-base64"
assert x["carrier"]["decoded_sha256"] == x["archive"]["sha256"]
print(x["tree"])
PY
```

どれか1件でも不一致なら停止する。値を補修・推測して続行しない。

## 4. Carrierを取得し、canonical Base64と全hashを検査する

```sh
curl -fL --retry 5 --retry-all-errors "$BASE/$CARRIER" -o "download/$CARRIER"
```

次の処理は、Carrier自体のbyte数/SHA-256、標準Base64のcanonical性、decode後archiveのbyte数/SHA-256をすべて検査してからraw capsuleを書く。

```sh
python3 - "download/$RECEIPT" "download/$CARRIER" "download/$ARCHIVE" <<'PY'
import base64, hashlib, json, pathlib, sys
receipt_path, carrier_path, archive_path = map(pathlib.Path, sys.argv[1:])
x = json.loads(receipt_path.read_text(encoding="utf-8"))
raw = carrier_path.read_bytes()

assert len(raw) == x["carrier"]["bytes"]
assert hashlib.sha256(raw).hexdigest() == x["carrier"]["sha256"]
text = raw.decode("ascii")
assert not any(c.isspace() for c in text)
payload = base64.b64decode(text, validate=True)
assert base64.b64encode(payload).decode("ascii") == text
assert len(payload) == x["archive"]["bytes"]
payload_sha = hashlib.sha256(payload).hexdigest()
assert payload_sha == x["archive"]["sha256"]
assert payload_sha == x["carrier"]["decoded_sha256"]
archive_path.write_bytes(payload)
PY
```

SHA不一致、不正文字、空白、非canonical Base64、切断、容量不一致はすべて実行前に拒否する。

## 5. archiveを安全に展開する

このpayloadは`.git/`だけを含む。path traversal、link、device、`.git`外のentryを拒否してから展開する。

```sh
python3 - "download/$ARCHIVE" repo <<'PY'
import pathlib, sys, tarfile
archive, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with tarfile.open(archive, "r:gz") as tf:
    members = tf.getmembers()
    assert members
    for m in members:
        p = pathlib.PurePosixPath(m.name)
        parts = tuple(x for x in p.parts if x not in (".", ""))
        assert parts and parts[0] == ".git"
        assert not p.is_absolute() and ".." not in p.parts
        assert not m.issym() and not m.islnk()
        assert m.isdir() or m.isfile()
    tf.extractall(dest)
PY
```

## 6. worktreeをGit objectから再構築する

```sh
git -C repo reset --hard HEAD
```

Carrierはworktreeを二重搬送しない。tracked filesはGit tree/blobからこの操作で再生成する。

## 7. Git identityと完全性を検査する

```sh
EXPECTED_TREE="$(python3 -c 'import json; print(json.load(open("download/'"$RECEIPT"'"))["tree"])')"

test "$(git -C repo rev-parse HEAD)" = "$HEAD"
test "$(git -C repo rev-parse 'HEAD^{tree}')" = "$EXPECTED_TREE"
test "$(git -C repo rev-parse --is-shallow-repository)" = true
test "$(git -C repo rev-list --count HEAD)" = 1
test "$(git -C repo branch --show-current)" = proposals
test "$(git -C repo remote get-url origin)" = https://github.com/roccho-dev/ops.git
test "$(git -C repo cat-file -t "$HEAD")" = commit
test -z "$(git -C repo status --porcelain)"
git -C repo fsck --no-dangling
```

全件通った時だけ取得成功とする。

## raw assetを使える環境

binary downloadが安定している環境ではCarrierを介さず、同じReleaseの`<HEAD>.git.tar.gz`を取得してよい。ただしreceiptの`archive.bytes`と`archive.sha256`を必ず検査し、復元後のGit検査は省略しない。

Carrierはraw archiveと別の意味実装ではなく、**同じarchive bytesのneutral-text projection**。

## Actions artifact fallback

GitHub Actions artifact download toolが露出する環境では、workflow runの `repo-head-<HEAD>` artifactからraw capsuleとreceiptを取得できる。これは大容量byte bridgeとして有効だが、保持期限があるため恒久Authorityではない。

```text
Git exact commit = Source Authority
GitHub Release   = public persistent projection
Carrier          = neutral-text projection
Actions artifact = optional temporary transport
```

## Failure contract

次のいずれかなら即停止し、Greenにしない。

1. HEADが40桁lowercase hexでない。
2. receiptが取得できない、JSONでない、schema/statusが違う。
3. receiptの`id/head/source_repo/default_branch/release.tag`が期待値と違う。
4. Carrierのbyte数またはSHA-256がreceiptと違う。
5. Carrierに空白、不正Base64、非canonical表現がある。
6. decode後のbyte数/SHA-256がreceiptと違う。
7. archiveに`.git`外、path traversal、link、device等がある。
8. 展開または`git reset --hard HEAD`に失敗する。
9. HEADまたはtreeがreceiptと違う。
10. shallowでない、またはcommit countが1でない。
11. branch/originが期待値と違う。
12. `git fsck --no-dangling`が失敗する。
13. worktreeが復元直後からdirtyである。

モデル・人間・scriptによる欠落byteの補修は禁止。

## v1の境界

- **過去履歴は含まない。** HEAD commit、HEAD tree、その到達可能blob、およびshallow boundaryだけを保持する。
- HEAD commitが参照する親SHAはcommit metadataには残るが、その親object自体はcapsuleに含まれない。
- **submodule実体は保証しない。** superprojectのgitlinkは保持されるが、submodule repositoryのcheckoutはv1対象外。
- **Git LFS実体は保証しない。** workflowはLFS materializationを明示していないため、pointerか実体かを別途確認する。
- tracked file modeとsymlinkはGit treeから通常どおり復元されるが、submodule/LFSなど外部objectは別契約。
- untracked files、build cache、generated outputsは含まない。
- GitHub Release自体はGitHub設定上mutableになり得る。真正性はtag名だけでなく、full HEAD、receipt、payload SHA-256、復元Git OIDの一致で判定する。
- `latest`は発見用概念でありidentityではない。固定後はfull SHAだけを使う。
- Release assetを直接sandboxへ保存できないChatGPT effortもある。その場合、static mirrorまたはActions artifact adapterで**同じCarrier/raw bytes**を搬入し、同じreceipt/hash/Git検査を行う。

## Publisherの合格条件

`.github/workflows/repo-head-materialize-proof.yml` のrunは次をすべて満たすまで成功しない。

1. public repo/default branchを解決。
2. `git ls-remote`で40桁HEADを固定。
3. `--depth=1` fetch結果がそのHEADと一致。
4. shallow=true、commit count=1、`git fsck` PASS。
5. `.git`のみをtar.gz化。
6. 改行なし標準Base64 Carrier生成。
7. encode→decode→re-encodeのbyte一致。
8. Releaseへraw capsule、Carrier、receiptの3assetを公開。
9. 公開Release URLから3assetを再GETして公開前bytesと`cmp`。
10. 公開Carrierだけからrepoを再構築し、HEAD/tree/shallow/count/fsckを再検査。

## 既知の本番実証

2026-08-17、PR #108 merge後のHEADでproduction Releaseを生成し、publisher自身のpublic readbackと再構築がPASSしている。

```text
HEAD: 0078ffb1ab7efce2311f92aa77c54138180981b2
Tag:  repo-head-0078ffb1ab7efce2311f92aa77c54138180981b2
```

Release:

https://github.com/roccho-dev/ops/releases/tag/repo-head-0078ffb1ab7efce2311f92aa77c54138180981b2

この例は履歴上のproofであり、現在HEADの代替として使わない。
