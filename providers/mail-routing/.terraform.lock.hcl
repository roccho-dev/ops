# Checksums are the official SHA-256 ZIP asset digests from Cloudflare's
# terraform-provider-cloudflare v5.21.1 GitHub release, not generated test values.
# Source: https://api.github.com/repos/cloudflare/terraform-provider-cloudflare/releases/tags/v5.21.1
# No invented h1 checksum; zh hashes cover the official release ZIPs.
# OpenTofu's default registry host matches the Nix withPlugins directory.
provider "registry.opentofu.org/cloudflare/cloudflare" {
  version     = "5.21.1"
  constraints = "= 5.21.1"
  hashes = [
    "zh:049719425b8be43d9d4f0c208217aca0baa22374f061d7ff92f02563490f649c",
    "zh:0a8a3c1b26680b437fe9e7910ca81e532d36f8efacfb14f45690b6a779856993",
    "zh:32b61f80892243f7ab8e453fa038c1f3e2aac733ccb98307c2cfe798b2793b32",
    "zh:42c27f3cd62979e70716c51f682a3d131d51ad76d86dff83d8cdbfffcebac841",
    "zh:4c8cd464f9b6ecde5cd4430bbba4be3b810826105e51ef6328b6a2b69f821443",
    "zh:586ea42ef74d6c5bc4c9b89da6b1f8618a19f4e80272fe8d615e7d5b11c491af",
    "zh:b09b86c7cac7085e01c9b7a828f09d13c44589d3e3cd42f0b694ca3e4cd3ed0a",
    "zh:eac80665e60c701b37a6318f4e405d67f1720f8da5f93135c6256049282d3367",
  ]
}
