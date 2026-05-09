# restore UX

復元 UX は 3 つに分けます。

## 1. exact ref manual restore

人が中身を見たい時の最小手順です。
fetch 先は checked-out branch ではなく `refs/remotes/...` にします。

```bash
git init -b main /tmp/restored
cd /tmp/restored
git remote add refs-vault git@github.com:roccho-dev/refs.git
git fetch --no-tags refs-vault \
  +refs/heads/repos/specs/main:refs/remotes/refs-vault/main
git checkout -B main refs/remotes/refs-vault/main
```

## 2. tool restore

通常は `ops-refs-vault materialize` を使います。

```bash
ops-refs-vault materialize \
  --manifest refs-vault.manifest.json \
  --repo-id specs \
  --branch main \
  --dest /tmp/specs
```

## 3. manifest localPath restore

完全な local layout 復元では、manifest の `localPath` を使って repoId ごとに `materialize` します。
今は個別復元が正本です。
全 layout 復元コマンドは backlog に残します。

## 注意

欠損 branch の fallback は default 禁止です。
どうしても最初に見つかった branch を見たい時だけ、明示的に `--allow-any-branch` を付けます。
