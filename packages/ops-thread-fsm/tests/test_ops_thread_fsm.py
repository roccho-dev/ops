#!/usr/bin/env python3
from __future__ import annotations
import json,pathlib,subprocess,sys,tempfile,unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
BIN=ROOT/"bin"/"ops-thread-fsm"
BASE=json.loads((ROOT/"tests"/"fixtures"/"cases.json").read_text(encoding="utf-8"))
SHA_A="a"*64; SHA_B="b"*64

def safe_plan(**kw):
    d={"planComplete":True,"preAuthorized":True,"localBaseEvidenceValid":True,"noOverwrite":True,"noMerge":True,"noPush":True,"worktreeBranchAbsent":True,"successConditionsPresent":True,"failureConditionsPresent":True,"gatesPresent":True,"reportableEvidencePresent":True}
    d.update(kw); return d

class T(unittest.TestCase):
    def setUp(self): self.t=tempfile.TemporaryDirectory(); self.d=pathlib.Path(self.t.name)
    def tearDown(self): self.t.cleanup()
    def f(self,n,x):
        p=self.d/n; p.write_text(x if isinstance(x,str) else json.dumps(x,ensure_ascii=False),encoding="utf-8"); return str(p)
    def cli(self,*a): return subprocess.run([sys.executable,"-S",str(BIN),*a],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    def case(self,k): return BASE[k]
    def cl(self,x,rk="work",phase="impl"):
        r=self.cli("classify-readback","--input",self.f("in.json",x),"--phase",phase,"--request-kind",rk,"--json")
        return json.loads(r.stdout)
    def plan(self,x): return json.loads(self.cli("evaluate-plan","--input",self.f("p.json",x),"--json").stdout)
    def ready(self,delivery=None,impl="impl-review-pass\nok",merge=None,report=True,target="ready-for-merge-review"):
        delivery=delivery or self.case("manifest")
        args=["check-ready","--delivery",self.f("m.json",delivery),"--impl-review",self.f("i.json",{"text":impl}),"--local-gate",self.f("g.json",self.case("gate")),"--target",target,"--json"]
        if merge is not None: args += ["--merge-review",self.f("mr.json",{"text":merge})]
        if report: args += ["--run-report",self.f("RUN_REPORT.md",self.case("report"))]
        return self.cli(*args)
    def bad_manifest(self,kind):
        if kind=="missingPath": return {"ok":True,"count":1,"rows":[{"ok":True,"path":"","bytes":1,"bytesExpected":1,"sha256":SHA_A,"sha256Expected":SHA_A,"fileIndex":1,"fileCount":1}]}
        if kind=="badIndex": return {"ok":True,"count":2,"rows":[{"ok":True,"path":"a","bytes":1,"bytesExpected":1,"sha256":SHA_A,"sha256Expected":SHA_A,"fileIndex":1,"fileCount":2},{"ok":True,"path":"b","bytes":1,"bytesExpected":1,"sha256":SHA_B,"sha256Expected":SHA_B,"fileIndex":1,"fileCount":2}]}
        raise AssertionError(kind)
    def test_classify_readback_and_gate_verdicts(self):
        self.assertEqual(self.cl(self.case("streaming"))["nextStateKind"],"sleeping-900")
        self.assertEqual(self.cl(self.case("done"))["classification"],"output-missing")
        self.assertEqual(self.cl(self.case("candidate"))["nextStateKind"],"output-materialized")
        self.assertTrue(self.cl(self.case("reject"),"impl-review")["retry"])
        self.assertEqual(self.cl({"text":"impl-review-pass\nok"},"impl-review")["classification"],"impl-review-pass")
        self.assertEqual(self.cl({"text":"verdict: merge-review-pass\nok"},"merge-review","merge")["classification"],"merge-review-pass")
        bad=["do not emit impl-review-pass","`impl-review-pass` prose","not accepted as impl-review-pass","The review does not pass","review-pass 合格","pass","passed","合格","merge-review-pass"]
        for s in bad: self.assertNotEqual(self.cl({"text":s},"impl-review")["classification"],"impl-review-pass")
        bad=["do not emit merge-review-pass","`merge-review-pass` prose","not accepted as merge-review-pass","impl-review-pass mixed into merge-review","review-pass 合格","pass","passed","合格"]
        for s in bad: self.assertNotEqual(self.cl({"text":s},"merge-review","merge")["classification"],"merge-review-pass")
    def test_ready_for_merge_review_is_separate_from_merge_ready(self):
        r=self.ready(); j=json.loads(r.stdout)
        self.assertEqual(r.returncode,0); self.assertTrue(j["readyForMergeReview"]); self.assertFalse(j["mergeReady"]); self.assertEqual(j["stateKind"],"ready-for-merge-review")
        r=self.ready(merge="merge-review-pass\nok",target="merge-ready"); j=json.loads(r.stdout)
        self.assertEqual(r.returncode,0); self.assertTrue(j["mergeReady"]); self.assertEqual(j["stateKind"],"merge-ready")
        for kwargs in [dict(impl="review-pass 合格"),dict(impl="merge-review-pass\nok"),dict(delivery=self.case("manifestShallow")),dict(delivery=self.case("manifestZero")),dict(delivery=self.case("manifestBadSha")),dict(delivery=self.bad_manifest("missingPath")),dict(delivery=self.bad_manifest("badIndex")),dict(report=False)]:
            r=self.ready(**kwargs); self.assertNotEqual(r.returncode,0); self.assertFalse(json.loads(r.stdout)["readyForMergeReview"])
        for impl,merge in [("impl-review-pass\nok","impl-review-pass\nok"),("impl-review-pass\nok","review-pass 合格"),("The review does not pass; do not emit impl-review-pass","merge-review-pass\nok")]:
            r=self.ready(impl=impl,merge=merge,target="merge-ready"); self.assertNotEqual(r.returncode,0); self.assertFalse(json.loads(r.stdout)["mergeReady"])
    def test_plan_auto_continue_and_blocker_evidence(self):
        j=self.plan(safe_plan()); self.assertEqual(j["classification"],"accepted-plan"); self.assertEqual(j["nextStateKind"],"state-allowed-to-proceed-without-extra-user-agreement"); self.assertTrue(j["autoContinue"])
        j=self.plan(safe_plan(preAuthorized=False)); self.assertEqual(j["nextStateKind"],"state-requiring-user-gen0-agreement"); self.assertFalse(j["autoContinue"])
        self.assertEqual(self.plan({"planComplete":True})["classification"],"insufficient-plan")
        self.assertEqual(self.plan({"blockerClaim":"cannot connect","blockerEvidence":True})["classification"],"real-blocker")
        self.assertEqual(self.plan({"blockerClaim":"thread not created","readbackDisprovesBlocker":True})["classification"],"false-blocker")
        self.assertNotEqual(self.plan({"blockerClaim":"not sent"})["classification"],"real-blocker")
    def test_external_thread_needs_concrete_confirmation_and_readback(self):
        j=self.plan(safe_plan(externalThreadWork=True,sendConfirmation=True,readback=True))
        self.assertEqual(j["classification"],"insufficient-plan"); self.assertIn("externalThreadConcreteSendConfirmationAndReadback",j["evidence"])
        j=self.plan(safe_plan(externalThreadWork=True,sendConfirmationEvidence="sent id 1",readbackEvidence="readback text"))
        self.assertEqual(j["classification"],"accepted-plan"); self.assertTrue(j["autoContinue"])
    def test_permissions_prompt_and_dry_run_are_safe(self):
        j=json.loads(self.cli("next","--state-kind","allowed-to-implement","--dry-run","--json").stdout)
        self.assertTrue(j["permissions"]["implement"]); self.assertFalse(j["permissions"]["createWorktree"]); self.assertFalse(j["permissions"]["returnArtifact"]); self.assertFalse(j["permissions"]["sendReview"]); self.assertFalse(j["permissions"]["mergeReady"]); self.assertFalse(j["permissions"]["canonicalMerge"]); self.assertFalse(j["permissions"]["push"]); self.assertFalse(j["writes"]); self.assertFalse(j["sends"])
        self.assertTrue(json.loads(self.cli("next","--state-kind","allowed-to-create-worktree","--dry-run","--json").stdout)["permissions"]["createWorktree"])
        self.assertFalse(json.loads(self.cli("next","--state-kind","merge-ready","--dry-run","--json").stdout)["permissions"]["push"])
        prompt=self.cli("render-prompt","--phase","impl","--request-kind","work").stdout
        self.assertIn("ready-for-merge-review",prompt); self.assertIn("merge-ready",prompt); self.assertIn("no-overwrite",prompt)
if __name__=="__main__": unittest.main()
