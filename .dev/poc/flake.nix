{
  # ops 内 自己完結 PoC: jsonl -> nix output(package only) -> 同 ops が consume の閉路を証明。
  # 4原則: KISS(最小) / DRY(data.jsonl 単一ソース) / SOLID(from-jsonl=生成, consumes=検証 の単一責務) / YAGNI(汎用化しない)。
  # apps / devShells は出さない(specs outputReviewGate: packages/checks のみ許可に整合)。
  #
  # TODO(adrs): 理想は adrs repo の jsonl から「必要な jsonl だけ」を import して構築する機構。
  #   方針変更により当面は ops のみで完結(cross-repo の adrs import は保留)。
  #   cf. data.jsonl の id=todo-adrs-selective-import。
  description = "ops PoC: jsonl -> package-only nix output -> consumed within ops (self-contained closure)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forEach = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
      data = ./data.jsonl; # 唯一の入力(append-only)
    in
    {
      # package only: jsonl を入力に確定成果物を生成する(外部 input なし)
      packages = forEach (pkgs: {
        poc-from-jsonl =
          pkgs.runCommand "poc-from-jsonl" { nativeBuildInputs = [ pkgs.jq ]; }
            ''
              mkdir -p "$out"
              jq -s '{count: length, ids: [ .[].id ]}' ${data} > "$out/result.json"
            '';
      });

      # check: 同 ops の package output を input(consume)し、jsonl 由来と一致=閉路成立を検証
      checks = forEach (
        pkgs:
        let
          produced = self.packages.${pkgs.stdenv.hostPlatform.system}.poc-from-jsonl;
        in
        {
          poc-consumes =
            pkgs.runCommand "poc-consumes" { nativeBuildInputs = [ pkgs.jq ]; }
              ''
                got=$(jq -r '.count' ${produced}/result.json)
                want=$(jq -s 'length' ${data})
                test "$got" = "$want"
                mkdir -p "$out"
                echo "closed: package output count=$got matches source jsonl ($want) — self-contained" > "$out/proof.txt"
              '';
        }
      );
    };
}
