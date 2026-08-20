{ nixpkgsSrc, nixpkgsRev, system ? "x86_64-linux" }:
let
  pkgs = import nixpkgsSrc { inherit system; };
  shortRev = builtins.substring 0 12 nixpkgsRev;
  imageName = "ops-nixpkgs-proof";
  imageTag = shortRev;

  imageRoot = pkgs.buildEnv {
    name = "${imageName}-root";
    paths = [ pkgs.busybox ];
    pathsToLink = [ "/bin" ];
  };

  dockerImage = pkgs.dockerTools.buildImage {
    name = imageName;
    tag = imageTag;
    copyToRoot = imageRoot;
    config = {
      Cmd = [ "/bin/sh" "-c" "printf 'nixpkgs-oci-proof:${shortRev}\\n'" ];
      Env = [ "PATH=/bin" ];
      WorkingDir = "/";
      Labels = {
        "org.opencontainers.image.title" = imageName;
        "org.opencontainers.image.revision" = nixpkgsRev;
        "org.opencontainers.image.source" = "https://github.com/roccho-dev/ops/issues/187";
      };
    };
  };
in
pkgs.runCommand "${imageName}-oci-${shortRev}" {
  nativeBuildInputs = [ pkgs.skopeo pkgs.coreutils ];
  passthru = {
    inherit dockerImage imageName imageTag nixpkgsRev;
    nixpkgsVersion = pkgs.lib.version;
    busybox = pkgs.busybox;
    skopeo = pkgs.skopeo;
  };
} ''
  set -euo pipefail
  mkdir -p "$out"
  cp ${dockerImage} "$out/docker-image.tar"
  skopeo copy --insecure-policy \
    "docker-archive:${dockerImage}" \
    "oci-archive:$out/image.oci.tar:${imageName}:${imageTag}"
  skopeo inspect --raw "oci-archive:$out/image.oci.tar" > "$out/manifest.raw.json"
  skopeo inspect "oci-archive:$out/image.oci.tar" > "$out/inspect.json"
  printf '%s\n' '${nixpkgsRev}' > "$out/nixpkgs.rev"
  printf '%s\n' '${pkgs.lib.version}' > "$out/nixpkgs.version"
  printf '%s\n' '${imageName}:${imageTag}' > "$out/image.ref"
  sha256sum "$out/docker-image.tar" "$out/image.oci.tar" > "$out/SHA256SUMS"
''
