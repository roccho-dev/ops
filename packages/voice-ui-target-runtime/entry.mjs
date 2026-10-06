import path from "node:path";
import { loadJson, requireCondition as need, exactObjectKeys, sha256File, exactSha } from "./modules/core.mjs";
import { projectRequirements } from "./modules/input-contracts.mjs";
import { runTargetRuntime } from "./lib.mjs";

// Called only by the generated entry in the immutable Nix package. There is no
// executable path, provider host or runtime-install override in the user request.
// Neither mode executes the separately installed gate program; --describe only names it.
export function main(config, root, argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--describe") {
    process.stdout.write(JSON.stringify({ ...config, runtimeRoot: root }, null, 2) + "\n");
    return;
  }
  if (argv.length === 2 && argv[0] === "--requirements") {
    const request = loadJson(argv[1], "requirement request");
    exactObjectKeys(request, ["target", "obligation"], "requirement request");
    process.stdout.write(JSON.stringify(projectRequirements(request.target, request.obligation, config.opsSha)) + "\n");
    return;
  }
  need(argv.length === 2 && argv[0] === "--request", "usage: voice-ui-target-runtime --request approved.json | --requirements selected.json | --describe");
  // Input-overridden or unversioned Nix evaluations may run tests, never effects.
  exactSha(config.opsSha, "installed ops revision");
  const request = loadJson(argv[1]);
  exactObjectKeys(request, ["kind", "expected", "inputs", "output"], "approved request");
  exactObjectKeys(request.inputs, ["product", "projectionReceipt", "isolationVerdict"], "approved inputs");
  const installed = { opsSha: config.opsSha, appsSha: config.product.proof.merge_sha, artifactManifestSha256: config.product.manifestSha256 };
  for (const key of Object.keys(installed)) {
    need(request.expected[key] === installed[key], `approved ${key} differs from installed runtime`);
  }
  const executable = name => {
    const p = path.join(root, name);
    return {path:p,sha256:sha256File(p)};
  };
  // Only the package's own deploy/readback adapters run. The apps PRODUCT is a
  // data operand admitted against the installed pin; its acceptance runtime is not part of this closure.
  const result = runTargetRuntime({ ...request,
    installed: { product: config.product, unzip: config.unzip },
    adapters: { deploy: executable("deploy.mjs"), readback: executable("readback.mjs") },
  });
  process.stdout.write(JSON.stringify({ status: result.status, claim: result.claim, runtimeRoot: root }) + "\n");
}
