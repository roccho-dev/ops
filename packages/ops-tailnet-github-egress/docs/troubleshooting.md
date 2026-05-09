# ops-tailnet-github-egress troubleshooting

この文書は、App Connector 経由の GitHub push で再発しやすい問題だけを残します。

## GitHub route が tailscale0 ではない

`github.com` 宛の全 IPv4 route が `tailscale0` ではない時は push しません。
最初の IPv4 だけを見てはいけません。DNS retry 後に得た重複排除済みの全 IPv4 を
`ip route get` し、どれか 1 つでも `tailscale0` 以外なら失敗です。

```bash
ops-tailnet-github-egress route-check --domain github.com --json
github-route-check.sh github.com tailscale0
```

route gate が green でない push は、App Connector proof ではなく通常経路の GitHub push です。

## DNS が一時的に空になる

`getent ahostsv4 github.com` が一度空になることがあります。
短い retry を入れてから判断します。
一度の空応答だけで App Connector 不通とは決めません。

## SSH は通るが exit code が 1

GitHub SSH の成功表示は次の形です。

```text
Hi roccho-dev! You've successfully authenticated
```

GitHub は shell を提供しないため、成功表示でも exit code が 1 になることがあります。
CLI はこの成功文言を見ます。

## 大きい push が Writing objects 後に止まる

tailscale0 の MTU/PMTU で止まることがあります。
実 repo head など大きめの pack は long-transfer mode を使います。

```bash
ops-tailnet-github-egress push-local --long-transfer ...
```

long-transfer mode は、全 IPv4 route gate を通った GitHub IPv4 だけを pin し、`HostName=<route checked IPv4>`、`HostKeyAlias=github.com`、`ssh -4`、一時 `net.ipv4.tcp_mtu_probing=2`、restore を行います。

## App Connector device が egress loop する

g6i3 で App Connector route を受けると egress loop になりました。
connector 側は `accept-routes=false` が解決でした。

意味:

- App Connector device は GitHub へ出る側です。
- その device 自身が App Connector route を受けると、自分の egress を自分に戻す形になり得ます。
- connector device では route を受けない設定にします。

確認例:

```bash
tailscale status
tailscale debug prefs
```

必要なら connector device で次を使います。

```bash
tailscale set --accept-routes=false
```

この設定は tailnet 設計に影響するので、変更後は route check と GitHub SSH check を再実行します。
