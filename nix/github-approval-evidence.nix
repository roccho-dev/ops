{ pkgs ? import <nixpkgs> {} }:

pkgs.writeShellApplication {
  name = "github-approval-evidence";
  runtimeInputs = [ pkgs.python3 ];
  text = ''
    exec ${pkgs.python3}/bin/python3 ${../tools/github-approval-evidence-cli.py} "$@"
  '';
}
