#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1];B=R/"bin"/"ops-thread-fsm";C=json.loads((R/"tests"/"fixtures"/"cases.json").read_text())
def safe(**u):
 p=dict(planComplete=True,preAuthorized=True,localBaseEvidenceValid=True,successConditionsPresent=True,failureConditionsPresent=True,gatesPresent=True,reportableEvidencePresent=True,worktreeBranchAbsent=True,noMerge=True,noPush=True,noOverwrite=True,localBaseEvidence="local base abc123",baseEvidence="ops/specs base",upstreamEvidence="local upstream",headEvidence="candidate head",worktreeEvidence="absent worktree",branchEvidence="absent branch",successConditionsEvidence="success conditions",failureConditionsEvidence="failure conditions",gatesEvidence="required gates",reportableEvidence="reportable evidence");p.update(u);return p
class T(unittest.TestCase):
 def setUp(s):s.t=tempfile.TemporaryDirectory();s.d=pathlib.Path(s.t.name)
 def tearDown(s):s.t.cleanup()
 def f(s,n,x):p=s.d/n;p.write_text(x if isinstance(x,str) else json.dumps(x));return str(p)
 def j(s,*a):return json.loads(subprocess.run([sys.executable,"-S",str(B),*a],text=True,stdout=subprocess.PIPE).stdout)
 def cr(s,x,k="work",ph="impl"):return s.j("classify-readback","--input",s.f("r.json",x),"--phase",ph,"--request-kind",k,"--json")
 def pl(s,x):return s.j("evaluate-plan","--input",s.f("p.json",x),"--json")
 def test_request_sent_sleep_900_no_writes_or_sends(s):
  r=s.j("next","--state-kind","request-sent","--dry-run","--json")
  s.assertIn("sleep 900",r["nextAction"]);s.assertFalse(r["writes"]);s.assertFalse(r["sends"])
 def test_streaming_and_gate_specific_review_verdicts(s):
  s.assertEqual(s.cr(C["streaming"])["nextStateKind"],"sleeping-900")
  s.assertEqual(s.cr({"text":"impl-review-pass\nok"},"impl-review")["classification"],"impl-review-pass")
  s.assertEqual(s.cr({"text":"verdict: merge-review-pass\nok"},"merge-review","merge")["classification"],"merge-review-pass")
  for x in ["review-pass 合格","pass","not impl-review-pass","do not emit impl-review-pass"]:s.assertNotEqual(s.cr({"text":x},"impl-review")["classification"],"impl-review-pass")
  s.assertNotEqual(s.cr({"text":"impl-review-pass\nok"},"merge-review","merge")["classification"],"merge-review-pass")
 def test_false_and_real_blocker(s):
  s.assertEqual(s.pl({"blockerClaim":"cannot connect","readbackDisprovesBlocker":True,"readbackEvidence":"thread exists"})["classification"],"false-blocker")
  s.assertEqual(s.pl({"blockerClaim":"cannot connect","blockerEvidence":True})["classification"],"real-blocker")
  s.assertEqual(s.pl({"blockerClaim":"thread not created"})["classification"],"insufficient-plan")
 def test_safe_auto_continue_and_missing_safety_proofs(s):
  r=s.pl(safe());s.assertEqual(r["nextStateKind"],"state-allowed-to-proceed-without-extra-user-agreement");s.assertTrue(r["autoContinue"])
  for k in ["noMerge","noPush","noOverwrite"]:
   p=safe();del p[k];r=s.pl(p);s.assertEqual(r["classification"],"insufficient-plan");s.assertIn(k,r["missingEvidence"])
   r=s.pl(safe(**{k:False}));s.assertEqual(r["classification"],"escalation-needed");s.assertFalse(r["permissions"]["implement"])
  r=s.pl(safe(preAuthorized=False));s.assertEqual(r["nextStateKind"],"state-requiring-user-gen0-agreement");s.assertFalse(r["autoContinue"])
 def test_allowed_to_implement_is_not_merge_or_handoff(s):
  p=s.j("next","--state-kind","allowed-to-implement","--dry-run","--json")["permissions"];s.assertTrue(p["implement"])
  for k in ["createWorktree","returnArtifact","sendReview","readyForMergeReview","mergeReady","canonicalMerge","push","overwrite"]:s.assertFalse(p[k])
 def test_ready_for_review_and_merge_review_boundary(s):
  m=s.f("m.json",C["manifest"]);i=s.f("i.json",{"text":"impl-review-pass\nok"});g=s.f("g.json",{"ok":True});r=s.f("RUN_REPORT.md","ok\n")
  a=["check-ready","--delivery",m,"--impl-review",i,"--local-gate",g,"--run-report",r,"--json"]
  x=s.j(*a);s.assertTrue(x["readyForMergeReview"]);s.assertFalse(x["mergeReady"])
  x=s.j(*a[:-1],"--merge-review",s.f("mr.json",{"text":"review-pass 合格"}),"--target","merge-ready","--json");s.assertFalse(x["mergeReady"])
  x=s.j(*a[:-1],"--merge-review",s.f("mr2.json",{"text":"merge-review-pass\nok"}),"--target","merge-ready","--json");s.assertTrue(x["mergeReady"])
if __name__=="__main__":unittest.main()
