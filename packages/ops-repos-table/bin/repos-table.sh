#!/usr/bin/env bash
# repos-table — local checkout と remote bare の状態を 1 つの markdown 表に出す。
#
# 出力列: repo | local | remote
#   local : <branch>=<sha> [dirty:n] [br:n] [wt:n]
#   remote: <HEAD branch>=<sha> [+[canonical 外 branch,...]] [arch:n(refs/archive)]
#   "-" はその側に存在しないこと、"(not a git repo)" は dir のみの残骸を示す。
#
# remote 取得は ssh 1 往復に集約する。remote 不達は無音で欠損させず stderr に
# WARN を出す(欠損した表は「remote が空」と誤読されるため)。
#
# 環境変数で上書き: REMOTE(ssh 先) / RDIR(bare 群) / LDIR(checkout 群)
set -u

REMOTE="${REMOTE:-nixos@nixos-vm}"
RDIR="${RDIR:-/home/nixos/repos}"
LDIR="${LDIR:-/home/nixos/repos}"

declare -A R L

# ---- remote(bare): ssh 1 往復で全 repo 分を取得 -------------------------
remote_out=$(ssh -o ConnectTimeout=10 "$REMOTE" '
  for b in '"$RDIR"'/*.git; do
    [ -d "$b" ] || continue
    n=$(basename "$b" .git)
    h=$(git -C "$b" symbolic-ref --short HEAD 2>/dev/null)
    t=$(git -C "$b" rev-parse --short HEAD 2>/dev/null)
    extra=$(git -C "$b" for-each-ref refs/heads --format="%(refname:short)" | grep -vx "$h" | paste -sd, -)
    arch=$(git -C "$b" for-each-ref refs/archive --format=x | wc -l)
    s="$h=$t"
    [ -n "$extra" ] && s="$s +[$extra]"
    [ "$arch" -gt 0 ] && s="$s arch:$arch"
    printf "%s|%s\n" "$n" "$s"
  done' 2>/dev/null) || {
  echo "WARN: remote ($REMOTE) unreachable — remote 列は欠損" >&2
  remote_out=""
}
while IFS='|' read -r n state; do
  [ -n "$n" ] && R[$n]="$state"
done <<<"$remote_out"

# ---- local(checkout) ------------------------------------------------------
for d in "$LDIR"/*/; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  if [ ! -e "$d.git" ]; then
    L[$n]="(not a git repo)"
    continue
  fi
  br=$(git -C "$d" branch --show-current 2>/dev/null)
  [ -n "$br" ] || br="(detached)"
  sha=$(git -C "$d" rev-parse --short HEAD 2>/dev/null)
  dirty=$(git -C "$d" status --porcelain 2>/dev/null | wc -l)
  nb=$(git -C "$d" for-each-ref refs/heads --format=x | wc -l)
  wt=$(git -C "$d" worktree list 2>/dev/null | wc -l)
  s="$br=$sha"
  [ "$dirty" -gt 0 ] && s="$s dirty:$dirty"
  [ "$nb" -gt 1 ] && s="$s br:$nb"
  [ "$wt" -gt 1 ] && s="$s wt:$wt"
  L[$n]="$s"
done

# ---- join して 1 表に -------------------------------------------------------
echo "| repo | local | remote |"
echo "|---|---|---|"
printf '%s\n' "${!R[@]}" "${!L[@]}" | sort -u | while read -r n; do
  echo "| $n | ${L[$n]:--} | ${R[$n]:--} |"
done
