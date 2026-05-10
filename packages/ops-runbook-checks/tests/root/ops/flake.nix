{
  # Fixture tokens checked by ops-runbook-checks.
  packages = {
    x86_64-linux = {
      ops-thread-fsm = "packages.<system>.ops-thread-fsm";
      ops-runbook-checks = "packages.<system>.ops-runbook-checks";
    };
  };

  checks = {
    x86_64-linux = {
      ops-thread-fsm-check = "checks.<system>.ops-thread-fsm";
      ops-runbook-checks-check = "checks.<system>.ops-runbook-checks";
    };
  };

  packageWiring = "writeShellApplication";
  checkWiring = ''runCommand "ops-thread-fsm-check" and runCommand "ops-runbook-checks-check"'';
}
