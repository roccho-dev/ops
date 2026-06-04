{
  # ops-build-defs: append-only jsonl(ビルド宣言: nixpkg attr / hash 等)を
  #   nix が読み取り snapshot/選別して nix module(lib.snapshot)として提供する。
  # 設計: pure-eval(IFD なし)。nix 側で kind 選別=ビルド必要情報の昇格。separable(独立 flake)。
  # output は packages のみ(apps/devShells を出さない)。jsonl は immutable/append-only。
  description = "ops-build-defs: append-only jsonl -> nix snapshot/module (pure-eval, separable)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forEach = f: lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});

      # --- append-only jsonl を pure-eval で読む(= snapshot 対象) ---
      records =
        let
          raw = builtins.readFile ./defs.jsonl;
          lines = lib.filter (l: l != "") (lib.splitString "\n" raw);
        in
        map builtins.fromJSON lines;
      byKind = k: lib.filter (r: (r.kind or "") == k) records;

      # --- nix 側で選別/昇格 → snapshot(= nix module) ---
      snapshot = {
        schema = "ops-build-defs.snapshot.v1";
        nixpkgAttrs = map (r: r.attr) (byKind "nixpkg");
        hashes = lib.listToAttrs (map (r: { inherit (r) name; value = r.sha256; }) (byKind "hash"));
        total = builtins.length records;
        promoted = (builtins.length (byKind "nixpkg")) + (builtins.length (byKind "hash"));
      };
    in
    {
      # nix module: 宣言的仕様。consumer は pure-eval で参照(IFD なし)
      lib.snapshot = snapshot;

      packages = forEach (pkgs: {
        # 実体 package: snapshot を materialize(検証・分離単位)
        snapshot = pkgs.writeTextDir "snapshot.json" (builtins.toJSON snapshot);
        # 選別された nixpkg attr を集約した環境(動的可変性の被験体)
        tools-env = pkgs.buildEnv {
          name = "ops-build-defs-tools-env";
          paths = map (a: pkgs.${a}) snapshot.nixpkgAttrs;
        };
      });
    };
}
