import { accessors, ClaimV1 } from "../generated/core/ts/accessors";

const claim: ClaimV1 = { text: "schema-bound projection", confidence_level: "high" };
const level = accessors.claim_v1.confidence_level(claim);
const text = accessors.claim_v1.text(claim);

if (level !== "high" || text.length === 0) {
  throw new Error("unexpected projection sample");
}
