# ops-repos-table

repo 艦隊(local checkout + remote bare)の状態を 1 つの markdown 表で出す
観測 tool。read-only(local にも remote にも一切書かない)。

```sh
nix run .#ops-repos-table                 # 既定: LDIR=RDIR=/home/nixos/repos, REMOTE=nixos@nixos-vm
REMOTE=nixos@100.124.250.91 nix run .#ops-repos-table   # tailnet 名が引けない時は IP で
```

- remote 取得は ssh 1 往復。remote 不達は stderr WARN(無音欠損させない)。
- ops-handoff-pack の source-manifest 生成(git からの head/branch 状態取得)の
  read-only 観測版にあたる。将来 handoff tooling へ統合する余地あり。
