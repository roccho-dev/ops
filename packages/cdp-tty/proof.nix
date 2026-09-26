# Reuse the repository's exact public package-set lock, without resolving
# unrelated governance/credential inputs. The package/check recipe is not copied.
let
  locked = (builtins.fromJSON (builtins.readFile ../../flake.lock)).nodes.nixpkgs.locked;
  pkgs = import (builtins.fetchTarball {
    url = "https://github.com/${locked.owner}/${locked.repo}/archive/${locked.rev}.tar.gz";
    sha256 = locked.narHash;
  }) { };
in
(pkgs.callPackage ./default.nix { }).proof
