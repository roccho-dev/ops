# troubleshooting

## route が tailscale0 ではない

GitHub へ push しないでください。
先に `ops-tailnet-github-egress route-check --domain github.com --json` を通します。
`push-all` は GitHub remote では egress wrapper を使うので、route gate が失敗したら push も失敗します。

## 大きい push が Writing objects 後に止まる

`ops-tailnet-github-egress push-local --long-transfer` を使います。
long-transfer は GitHub IPv4 pin、`HostKeyAlias=github.com`、一時 `net.ipv4.tcp_mtu_probing=2`、restore を行います。

## DNS が一時的に空になる

`getent ahostsv4 github.com` が一度空になることがあります。
retry 前提にします。

## App Connector device が egress loop する

g6i3 で App Connector route を受けると loop しました。
connector 側は `accept-routes=false` を使うのが解決でした。

この知見は `ops-tailnet-github-egress` の troubleshooting にも昇格する必要があります。

## materialize が目的 branch 以外を復元する

古い `refs-vault-materialize.sh` は欠損 branch で最初の branch に fallback しました。
`ops-refs-vault materialize` は default で失敗します。

## shallow repo の push が expected object で失敗する

shallow repo は exact history backup として扱いません。
必要なら unshallow するか、snapshot shelter と明記します。


## `git push refs-vault` が GitHub remote で何も push しない

これは意図した安全動作です。GitHub remote では `adopt` / `materialize` が
`remote.<name>.push` を設定しません。通常の `git push refs-vault` を許すと、
`ops-tailnet-github-egress` の route gate / long-transfer / HostName pin を迂回できます。
GitHub へ push する時は `ops-refs-vault push-all` を使います。
local bare remote と GitHub では remote 設定の責務が異なります。

## push-all が GitHub remote で止まる

`push-all` は GitHub remote では通常の `git push` を直接呼びません。
`ops-tailnet-github-egress push-local --long-transfer` が見つからない時、または `sudo -n sysctl -w net.ipv4.tcp_mtu_probing=2` が許可されていない時は止まります。
評価前に `nix run /home/nixos/repos/ops#ops-tailnet-github-egress -- policy --json` と route-check を確認します。

## Git push で守れないもの

Git push は committed object だけを守ります。dirty / untracked / ignored / secret / build cache は保護しません。
これらが必要な時は inventory で blocker として扱い、bundle / archive / secret manager / build cache policy を別に用意します。
