{
  description = "ops README artifact packet";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      mkArtifact = pkgs: pkgs.runCommand "ops-readme-artifact" { } ''
        set -euo pipefail
        mkdir -p "$out"
        cat > "$out/README.md" <<'EOF'
# ops

Non-authority README artifact for the ops repository.

## Purpose

Provide operational packages, runtime receipts, deployment records, rollback records, and transfer evidence.

## Authority boundary

- adrs owns accepted meaning
- governance projects and checks accepted inputs
- ops emits execution evidence and receipts
- README artifacts are evidence, not authority

## Inputs

- accepted operational contracts
- runtime and deployment receipt contracts
- repo-local package and check declarations
- governance convention checks

## Outputs / artifacts

- README.md
- manifest.json
- sources.jsonl
- receipt.json

## Checks

- nix flake check
- repo convention check
- readme-artifact packet check

## Ownership / handoff

ops repo CI owns this artifact packet. ops receipts are evidence inputs for closure and transfer views.
EOF
        cat > "$out/sources.jsonl" <<'EOF'
{"kind":"artifact.source.v1","artifact":"ops-readme","sourceKind":"runtimeReceiptContract","ref":"roccho-dev/ops#6","authority":false}
{"kind":"artifact.source.v1","artifact":"ops-readme","sourceKind":"deploymentRecordContract","ref":"roccho-dev/ops#7","authority":false}
{"kind":"artifact.source.v1","artifact":"ops-readme","sourceKind":"transferReceiptContract","ref":"roccho-dev/ops#10","authority":false}
EOF
        cat > "$out/manifest.json" <<'EOF'
{"kind":"repo.readmeArtifact.manifest.v1","repo":"roccho-dev/ops","artifactOwner":"repo-ci","nonAuthority":true,"readmeMode":"generated","workflow_definition":"checked_in","artifact_source":"nix-output","artifact_generation":"generated"}
EOF
        cat > "$out/receipt.json" <<'EOF'
{"kind":"repo.readmeArtifact.receipt.v1","repo":"roccho-dev/ops","artifactOwner":"repo-ci","nonAuthority":true,"source":"nix-output","entrypoint":"nix build ./packages/ops-readme-artifact","requiredFiles":["README.md","manifest.json","sources.jsonl","receipt.json"]}
EOF
        test -s "$out/README.md"
        test -s "$out/manifest.json"
        test -s "$out/sources.jsonl"
        test -s "$out/receipt.json"
      '';
    in {
      packages = forEachSystem (pkgs: {
        default = mkArtifact pkgs;
        readme-artifact = mkArtifact pkgs;
      });
      checks = forEachSystem (pkgs: {
        readme-artifact = pkgs.runCommand "ops-readme-artifact-check" { } ''
          test -s ${mkArtifact pkgs}/README.md
          test -s ${mkArtifact pkgs}/manifest.json
          test -s ${mkArtifact pkgs}/sources.jsonl
          test -s ${mkArtifact pkgs}/receipt.json
          grep -q '"nonAuthority":true' ${mkArtifact pkgs}/manifest.json
          grep -q '"artifactOwner":"repo-ci"' ${mkArtifact pkgs}/manifest.json
          grep -q '"source":"nix-output"' ${mkArtifact pkgs}/receipt.json
          touch "$out"
        '';
      });
    };
}
