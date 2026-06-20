#!/usr/bin/env python3
import json, sys
POLICY_REF = "334997669f1889a8e2658730c616d2d4510d4536"
OPS_REF = "2249fb84a6c0ba50b95b489f46e9c2b8a2734a8d"
ADRS_REF = "98fea894a7637ab0d02354f680e4f27df7b144e8"
SCOPE = "adopt accepted full-corpus typed semantic authority as policy semantic authority for the fixed policy input ref only"
REQUIRED_DOES_NOT = set(["policy.git deletion", "policy.git retirement", "cutover approval", "canonical write", "SSOT adoption", "end-to-end retirement proof"])
def verdict(record):
    if record.get("kind") != "policy.ownerAdoptionApproval.v1": return "REJECT"
    if record.get("policyInputRef") != POLICY_REF or record.get("opsEvidenceRef") != OPS_REF or record.get("adrsEvidenceRef") != ADRS_REF: return "REJECT"
    if record.get("approver", {}).get("role") != "owner": return "REJECT"
    if record.get("decision") == "approved" and record.get("approved") is True:
        if record.get("scope") != SCOPE: return "REJECT"
        if not record.get("approvalRef") or not record.get("approvedAt"): return "REJECT"
        if not REQUIRED_DOES_NOT.issubset(set(record.get("doesNotApprove", []))): return "REJECT"
        return "ACCEPT_SCOPE_ONLY"
    if record.get("decision") in {"deferred", "rejected"} and record.get("approved") is False:
        if not (record.get("decisionRef") or record.get("approvalRef")): return "REJECT"
        return "BLOCK_WITH_OWNER_DECISION"
    return "REJECT"
def main(path):
    ok = True
    for line in open(path, encoding="utf-8"):
        c = json.loads(line)
        actual = verdict(c["record"])
        passed = actual == c["expected"]
        ok = ok and passed
        print(json.dumps({"caseId": c["caseId"], "expected": c["expected"], "actual": actual, "pass": passed}, separators=(",",":")))
    return 0 if ok else 1
if __name__ == "__main__": raise SystemExit(main(sys.argv[1]))
