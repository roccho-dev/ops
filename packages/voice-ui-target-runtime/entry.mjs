import path from "node:path";
import { loadJson, requireCondition as need, exactObjectKeys, sha256File, exactSha } from "./modules/core.mjs";
import { runTargetRuntime } from "./lib.mjs";

// Called only by the generated entry in the immutable Nix package. There is no
// executable path, provider host or runtime-install override in the user request.
export function main(config, root, argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--describe") {
    process.stdout.write(JSON.stringify({ ...config, runtimeRoot: root }, null, 2) + "\n");
    return;
  }
  need(argv.length === 2 && argv[0] === "--request", "usage: voice-ui-target-runtime --request approved.json | --describe");
  // Input-overridden or unversioned Nix evaluations may run tests, never effects.
  exactSha(config.opsSha, "installed ops revision");
  const request = loadJson(argv[1]);
  exactObjectKeys(request, ["kind", "expected", "inputs", "output"], "approved request");
  exactObjectKeys(request.inputs, ["projectionReceipt", "isolationVerdict"], "approved inputs");
  for (const key of ["opsSha", "appsSha", "artifactManifestSha256"]) {
    need(request.expected[key] === config[key], `approved ${key} differs from installed runtime`);
  }
  const executable = name => {
    const p = path.join(root, name);
    return {path:p,sha256:sha256File(p)};
  };
  const result = runTargetRuntime({ ...request,
    inputs: { ...request.inputs, artifactRoot: config.artifactRoot },
    adapters: { deploy: executable("deploy.mjs"), readback: executable("readback.mjs"),
      acceptance: {path:config.acceptance,sha256:sha256File(config.acceptance)} },
  });
  process.stdout.write(JSON.stringify({ status: result.status, claim: result.claim, runtimeRoot: root }) + "\n");
}
