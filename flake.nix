{
  description = "ops: operational packages implementing governance contracts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    governance = {
      # Pin to sibling canonical governance checkout; flake.lock intentionally records a local path, not a stale external governance rev.
      url = "path:../governance";
      flake = false;
    };
    # 分離可能な build 定義 package(append-only jsonl -> nix snapshot/module)。
    # flake.lock が snapshot。defs.jsonl 追記後 `nix flake update ops-build-defs` で再 snapshot。
    # 将来 ops から分離する場合は url を ssh://…/ops-build-defs.git に差し替えるのみ。
    ops-build-defs = {
      url = "path:./packages/ops-build-defs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # G2 nodejs-only: node26 を nixpkgs(max nodejs_25)ではなく git+https から取得 (DEC-20260604-node26-via-git-https-from-source)。
    # nodejs/node に flake.nix は無いため flake=false のソース入力 + 自前 derivation(ソースビルド)。
    # v26.3.0 を commit rev で pin し可変タグの供給網リスクを排除 (DC-N-05)。
    nodejs-src = {
      url = "git+https://github.com/nodejs/node?ref=refs/tags/v26.3.0&rev=b7e6a5d37e7a14ef0f2cc95214b95d66c4081415";
      flake = false;
    };
  };

  outputs = inputs: import ./outputs.nix inputs;
}
