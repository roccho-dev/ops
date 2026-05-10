{
  # Fixture tokens checked by ops-runbook-checks.
  ops-thread-fsm = "packages.<system>.ops-thread-fsm";
  ops-thread-fsm-check = "checks.<system>.ops-thread-fsm";
  ops-tailnet-github-egress = "packages.<system>.ops-tailnet-github-egress";
  ops-tailnet-github-egress-check = "checks.<system>.ops-tailnet-github-egress";
  ops-refs-vault = "packages.<system>.ops-refs-vault";
  ops-refs-vault-check = "checks.<system>.ops-refs-vault";
  packageWiring = "writeShellApplication";
  checkWiring = ''runCommand "ops-thread-fsm-check"'';
  # Raw search token preserved for ops-runbook-checks without Nix interpolation.
  # self.packages.${pkgs.stdenv.hostPlatform.system}.ops-thread-fsm
  packageReference = "self.packages.<system>.ops-thread-fsm";
}
