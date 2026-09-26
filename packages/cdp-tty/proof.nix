# Reuse the root flake's selected public package-set lock, without resolving
# unrelated governance/credential inputs. The package/check recipe is not copied.
let
  lock = builtins.fromJSON (builtins.readFile ../../flake.lock);
  selected = lock.nodes.${lock.root}.inputs.nixpkgs;
  locked = assert builtins.isString selected; lock.nodes.${selected}.locked;
  pkgs = import (builtins.fetchTarball {
    url = "https://github.com/${locked.owner}/${locked.repo}/archive/${locked.rev}.tar.gz";
    sha256 = locked.narHash;
  }) { };
in
(pkgs.callPackage ./default.nix { }).proof
