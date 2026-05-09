{
  # Fixture tokens checked by ops-runbook-checks.
  ops-thread-fsm = "packages.<system>.ops-thread-fsm";
  ops-thread-fsm-check = "checks.<system>.ops-thread-fsm";
  packageWiring = "writeShellApplication";
  checkWiring = ''runCommand "ops-thread-fsm-check"'';
  # Raw search token preserved for ops-runbook-checks without Nix interpolation.
  # self.packages.${pkgs.stdenv.hostPlatform.system}.ops-thread-fsm
  packageReference = "self.packages.<system>.ops-thread-fsm";
}
