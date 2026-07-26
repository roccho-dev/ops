{ pkgs ? import <nixpkgs> {} }:

pkgs.writeShellApplication {
  name = "github-approval-evidence";
  runtimeInputs = [ pkgs.python3 ];
  text = ''
    export GITHUB_APPROVAL_EVIDENCE_MODULE=${../tools/github-approval-evidence.py}
    exec ${pkgs.python3}/bin/python3 ${../tools/github-approval-evidence-cli.py} "$@"
  '';
}
