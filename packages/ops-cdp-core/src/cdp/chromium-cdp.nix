{ ... }:
{
  perSystem =
    { pkgs, ... }:
    let
      inherit (pkgs) lib;

      chromiumPkg = pkgs.chromium;
      qjs = lib.getExe' pkgs.quickjs-ng "qjs";
      cdpScriptSrc = builtins.path {
        path = ./.;
        name = "chromium-cdp-src";
      };

      cdpBridgeCommand = pkgs.writeShellApplication {
        name = "cdp-bridge";
        runtimeInputs = [ pkgs.python3 ];
        text = ''
          exec ${pkgs.python3}/bin/python3 ${./cdp-bridge.py} "$@"
        '';
      };
      cdpBridge = pkgs.symlinkJoin {
        name = "cdp-bridge";
        paths = [ cdpBridgeCommand ];
      };

      chromiumCdp = pkgs.writeShellScriptBin "chromium-cdp" ''
        set -euo pipefail

        port="''${HQ_CHROME_PORT:-9222}"
        addr="''${HQ_CHROME_ADDR:-127.0.0.1}"
        profile_dir="''${HQ_CHROME_PROFILE_DIR:-$HOME/.secret/hq/chromium-cdp-profile}"

        mkdir -p "$profile_dir" 2>/dev/null || true
        chmod 700 "$profile_dir" 2>/dev/null || true

        extra=()
        if [ "''${HQ_CHROME_HEADLESS:-0}" = "1" ]; then
          extra+=(--headless=new --disable-gpu)
        fi
        if [ "''${HQ_CHROME_NO_SANDBOX:-0}" = "1" ]; then
          extra+=(--no-sandbox --disable-setuid-sandbox)
        fi

        exec ${chromiumPkg}/bin/chromium \
          --remote-debugging-address="$addr" \
          --remote-debugging-port="$port" \
          --user-data-dir="$profile_dir" \
          --no-first-run \
          --no-default-browser-check \
          --disable-dev-shm-usage \
          "''${extra[@]}" \
          "$@"
      '';

      chromiumCdpWsUrl = pkgs.writeShellScriptBin "chromium-cdp-wsurl" ''
        set -euo pipefail

        port="''${HQ_CHROME_PORT:-9222}"
        addr="''${HQ_CHROME_ADDR:-127.0.0.1}"

        exec ${cdpBridge}/bin/cdp-bridge wsurl --addr "$addr" --port "$port"
      '';

      mkQjsCommand =
        { name
        , script
        , pathPkgs ? [ cdpBridge ]
        , extraEnv ? ""
        }:
        pkgs.writeShellScriptBin name ''
          set -euo pipefail
          export PATH=${lib.makeBinPath pathPkgs}:$PATH
          export HQ_CDP_SCRIPT_SRC=${cdpScriptSrc}
          export HQ_CDP_QJS=${qjs}
          ${extraEnv}
          exec ${qjs} --std -m ${cdpScriptSrc}/${script} "$@"
        '';

      qjsCommands = {
        chromium-cdp-status = { script = "chromium-cdp-status.mjs"; };
        chromium-cdp-app-login = { script = "chromium-cdp-app-login.mjs"; };
        chromium-cdp-chatgpt-login = { script = "chromium-cdp-chatgpt-login.mjs"; };
        chromium-cdp-chatgpt-doctor = { script = "chromium-cdp-chatgpt-doctor.mjs"; };
        chromium-cdp-open-thread = { script = "chromium-cdp-open-thread.mjs"; };
        chromium-cdp-read-thread = { script = "read-thread.mjs"; };
        chromium-cdp-search-chatgpt = { script = "search-chatgpt.mjs"; };
        chromium-cdp-hq-threads = { script = "hq-threads.mjs"; };

        chromium-cdp-list-artifacts = { script = "chromium-cdp-list-artifacts.mjs"; };
        chromium-cdp-download-chatgpt-artifacts = { script = "download-chatgpt-artifacts.mjs"; };
        chromium-cdp-fetch-artifact = { script = "chromium-cdp-fetch-artifact.mjs"; };
        chromium-cdp-fetch-artifact-strict = { script = "chromium-cdp-fetch-artifact-strict.mjs"; pathPkgs = [ cdpBridge pkgs.coreutils ]; };
        chromium-cdp-recover-artifact-set = {
          script = "chromium-cdp-recover-artifact-set.mjs";
          pathPkgs = [ cdpBridge pkgs.coreutils pkgs.python3 ];
          extraEnv = ''
            export HQ_CDP_PYTHON=${lib.getExe pkgs.python3}
          '';
        };
        chromium-cdp-wait-artifacts = { script = "chromium-cdp-wait-artifacts.mjs"; };
        chromium-cdp-downloads-quarantine = { script = "chromium-cdp-downloads-quarantine.mjs"; pathPkgs = [ pkgs.coreutils ]; };
        chromium-cdp-inspect-artifact = {
          script = "chromium-cdp-inspect-artifact.mjs";
          pathPkgs = [ pkgs.python3 ];
          extraEnv = ''
            export HQ_CDP_PYTHON=${lib.getExe pkgs.python3}
          '';
        };

        chromium-cdp-create-project-thread = { script = "chromium-cdp-create-project-thread.mjs"; };
        chromium-cdp-send-chatgpt = { script = "send-chatgpt.mjs"; };
        chromium-cdp-upload-chatgpt-file = { script = "upload-chatgpt-file.mjs"; };
        chromium-cdp-upload-project-source-text = { script = "chromium-cdp-upload-project-source-text.mjs"; };
        chromium-cdp-upload-project-source-file = { script = "chromium-cdp-upload-project-source-file.mjs"; };
        chromium-cdp-project-source-list = { script = "chromium-cdp-project-source-list.mjs"; };
        chromium-cdp-project-source-delete = { script = "chromium-cdp-project-source-delete.mjs"; };
        chromium-cdp-project-access-probe = { script = "chromium-cdp-project-access-probe.mjs"; };
        chromium-cdp-project-inventory = { script = "project-inventory.mjs"; };
        chromium-cdp-projectize-thread = { script = "projectize-thread.mjs"; };
        chromium-cdp-project-sources-promote-turn = { script = "project-sources-promote-turn.mjs"; };
        chromium-cdp-project-sources-collect-files = { script = "project-sources-collect-files.mjs"; };
        chromium-cdp-project-sources-roundtrip = { script = "project-sources-roundtrip.mjs"; };
        chromium-cdp-project-sources-turn-roundtrip = { script = "project-sources-turn-roundtrip.mjs"; };
        chromium-cdp-project-source-reread = { script = "chromium-cdp-project-source-reread.mjs"; };

        chromium-cdp-source-snapshot-text = { script = "chromium-cdp-source-snapshot-text.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-worker-artifact-validate = { script = "chromium-cdp-worker-artifact-validate.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-worker-apply = { script = "chromium-cdp-worker-apply.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-worker-am-apply = { script = "chromium-cdp-worker-am-apply.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-package-run = { script = "chromium-cdp-package-run.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-package-run-state = { script = "chromium-cdp-package-run-state.mjs"; pathPkgs = [ cdpBridge pkgs.git pkgs.coreutils ]; };
        chromium-cdp-git-ref-health = { script = "chromium-cdp-git-ref-health.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-thread-ledger = { script = "chromium-cdp-thread-ledger.mjs"; pathPkgs = [ pkgs.coreutils ]; };
        chromium-cdp-worker-merge-queue = { script = "chromium-cdp-worker-merge-queue.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-host-git-two-worker-smoke = { script = "chromium-cdp-host-git-two-worker-smoke.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
        chromium-cdp-host-git-workflow-regression = { script = "chromium-cdp-host-git-workflow-regression.mjs"; pathPkgs = [ pkgs.git pkgs.coreutils ]; };
      };

      qjsCommandBins = lib.mapAttrs (
        name: spec: mkQjsCommand ({ inherit name; } // spec)
      ) qjsCommands;

      mkProjectTransportCommand =
        { name
        , subcommand
        }:
        pkgs.writeShellScriptBin name ''
          set -euo pipefail
          export PATH=${lib.makeBinPath ([ cdpBridge pkgs.coreutils pkgs.python3 pkgs.quickjs-ng ] ++ lib.attrValues qjsCommandBins)}:$PATH
          exec ${pkgs.python3}/bin/python3 ${cdpScriptSrc}/project-transport.py ${subcommand} "$@"
        '';

      projectTransportCommands = {
        project-transport-doctor = { subcommand = "doctor"; };
        project-transport-env = { subcommand = "env"; };
        project-source-put = { subcommand = "source-put"; };
        project-source-put-classify-examples = { subcommand = "source-put-classify-examples"; };
        project-source-list = { subcommand = "source-list"; };
        project-source-delete = { subcommand = "source-delete"; };
        project-thread-create = { subcommand = "thread-create"; };
        project-thread-send = { subcommand = "thread-send"; };
        project-thread-readback = { subcommand = "thread-readback"; };
        project-artifact-fetch = { subcommand = "artifact-fetch"; };
        project-transport-claim = { subcommand = "claim"; };
        project-handoff-preflight = { subcommand = "handoff-preflight"; };
        project-transport-run = { subcommand = "run"; };
      };

      projectTransportCommandBins = lib.mapAttrs (
        name: spec: mkProjectTransportCommand ({ inherit name; } // spec)
      ) projectTransportCommands;

      chromiumCdpChatgptCommandMap = pkgs.writeShellScriptBin "chromium-cdp-chatgpt-command-map" ''
        set -euo pipefail
        exec ${pkgs.coreutils}/bin/cat ${cdpScriptSrc}/docs/chatgpt-command-map.md
      '';

      cdp = pkgs.symlinkJoin {
        name = "cdp";
        paths = [
          chromiumPkg
          chromiumCdp
          chromiumCdpWsUrl
          chromiumCdpChatgptCommandMap
          cdpBridge
          (lib.getBin pkgs.git)
          (lib.getBin pkgs.coreutils)
          (lib.getBin pkgs.python3)
          (lib.getBin pkgs.quickjs-ng)
        ] ++ lib.attrValues qjsCommandBins ++ lib.attrValues projectTransportCommandBins;
      };

      launcherPackages = {
        hq-chromium = chromiumPkg;
        chromium-cdp = chromiumCdp;
        chromium-cdp-wsurl = chromiumCdpWsUrl;
        chromium-cdp-chatgpt-command-map = chromiumCdpChatgptCommandMap;
        cdp-bridge = cdpBridge;
        chromium-cdp-tools = cdp;
        cdp = cdp;
      };

      commandApps = lib.mapAttrs (
        name: pkg: {
          type = "app";
          program = "${pkg}/bin/${name}";
        }
      ) (qjsCommandBins // projectTransportCommandBins // {
        chromium-cdp = chromiumCdp;
        chromium-cdp-wsurl = chromiumCdpWsUrl;
        chromium-cdp-chatgpt-command-map = chromiumCdpChatgptCommandMap;
      });
    in
    {
      packages = launcherPackages // qjsCommandBins // projectTransportCommandBins;
      apps = commandApps;
    };
}
