#!/usr/bin/env node
import { loadOne, verifyReceipt } from "../verify.mjs";

const good = {
  schema: "ops.deploy-effect.receipt/1",
  authority: false,
  status: "PASS",
  provider: "example",
  target: "preview",
  sourceRevision: "deadbeef",
  providerDeploymentId: "dep_1",
  deploymentUrl: "https://example.invalid",
  probe: { path: "/health", status: 200 },
};

verifyReceipt({ ...good });

const bad = [];
bad.push({ ...good, authority: true });
bad.push({ ...good, deploymentUrl: "http://example.invalid" });
bad.push({ ...good, probe: { path: "/health", status: 503 } });
bad.push({ ...good, target: "unknown" });
bad.push({ ...good, sourceRevision: "" });

for (const value of bad) {
  let rejected = false;
  try {
    verifyReceipt(value);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("invalid receipt was accepted");
}

let multipleRejected = false;
try {
  loadOne("{}\n{}\n");
} catch {
  multipleRejected = true;
}
if (!multipleRejected) throw new Error("multiple receipt lines were accepted");

console.log("deploy-adapter contract PASS");
