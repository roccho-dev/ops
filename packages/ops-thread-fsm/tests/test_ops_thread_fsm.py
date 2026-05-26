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
 def test_handoff_created_is_nonterminal_and_localize_classifier(s):
  h=s.j("next","--state-kind","handoff-created","--dry-run","--json")
  s.assertFalse(any(h["permissions"].values()));s.assertIn("non-terminal",h["nextAction"])
  stale=s.j("classify-localize","--input",s.f("stale.json",{"policyFresh":False}),"--json")
  s.assertEqual(stale["stateKind"],"stale-policy-claim")
  drift=s.j("classify-localize","--input",s.f("drift.json",{"policyFresh":True,"canonicalNoDrift":False}),"--json")
  s.assertEqual(drift["stateKind"],"stale-canonical-head")
  project=s.j("classify-localize","--input",s.f("project.json",{"policyFresh":True,"canonicalNoDrift":True,"projectHandoffSent":True}),"--json")
  s.assertEqual(project["stateKind"],"project-handoff-sent")
  ready=s.j("classify-localize","--input",s.f("ready.json",{"policyFresh":True,"canonicalNoDrift":True,"mergeReviewPass":True,"localGatePass":True,"runReportPresent":True}),"--json")
  s.assertEqual(ready["stateKind"],"localizer-ready");s.assertTrue(ready["ready"])
 def test_ready_for_review_and_merge_review_boundary(s):
  m=s.f("m.json",C["manifest"]);i=s.f("i.json",{"text":"impl-review-pass\nok"});g=s.f("g.json",{"ok":True});r=s.f("RUN_REPORT.md","ok\n")
  a=["check-ready","--delivery",m,"--impl-review",i,"--local-gate",g,"--run-report",r,"--json"]
  x=s.j(*a);s.assertTrue(x["readyForMergeReview"]);s.assertFalse(x["mergeReady"])
  x=s.j(*a[:-1],"--merge-review",s.f("mr.json",{"text":"review-pass 合格"}),"--target","merge-ready","--json");s.assertFalse(x["mergeReady"])
  x=s.j(*a[:-1],"--merge-review",s.f("mr2.json",{"text":"merge-review-pass\nok"}),"--target","merge-ready","--json");s.assertTrue(x["mergeReady"])
 def test_discussion_same_revision_gate(s):
  base={"discussionId":"d1","proposalRevision":"r3","noObjectionsRequiredFrom":["A","B"]}
  ok=dict(base,responses=[{"actorId":"A","proposalRevision":"r3","verdict":"NO_UNRESOLVED_OBJECTIONS"},{"actorId":"B","proposalRevision":"r3","verdict":"NO_UNRESOLVED_OBJECTIONS"}])
  x=s.j("check-discussion","--input",s.f("d-ok.json",ok),"--json");s.assertEqual(x["classification"],"discussion-no-objections-confirmed");s.assertTrue(x["discussionComplete"])
  missing=dict(base,responses=[{"actorId":"A","proposalRevision":"r3","verdict":"NO_UNRESOLVED_OBJECTIONS"}])
  x=s.j("check-discussion","--input",s.f("d-missing.json",missing),"--json");s.assertEqual(x["classification"],"discussion-response-required");s.assertEqual(x["missingCounterparties"],["B"])
  stale=dict(base,responses=[{"actorId":"A","proposalRevision":"r2","verdict":"NO_UNRESOLVED_OBJECTIONS"},{"actorId":"B","proposalRevision":"r3","verdict":"NO_UNRESOLVED_OBJECTIONS"}])
  x=s.j("check-discussion","--input",s.f("d-stale.json",stale),"--json");s.assertEqual(x["classification"],"discussion-response-required");s.assertEqual(x["missingCounterparties"],["A"])
  obj=dict(base,responses=[{"actorId":"A","proposalRevision":"r3","verdict":"NO_UNRESOLVED_OBJECTIONS"},{"actorId":"B","proposalRevision":"r3","verdict":"UNRESOLVED_OBJECTIONS","objections":[{"objectionId":"B1","objectionText":"missing continuation states"}]}])
  x=s.j("check-discussion","--input",s.f("d-obj.json",obj),"--json");s.assertEqual(x["classification"],"discussion-objections-present");s.assertFalse(x["discussionComplete"])
  parent=dict(base,responses=[{"actorId":"A","proposalRevision":"r3","verdict":"NO_UNRESOLVED_OBJECTIONS"},{"actorId":"B","proposalRevision":"r3","verdict":"UNRESOLVED_OBJECTIONS","objections":[{"objectionId":"B2","objectionText":"needs user choice","requiresParentDecision":True}]}])
  x=s.j("check-discussion","--input",s.f("d-parent.json",parent),"--json");s.assertEqual(x["classification"],"discussion-blocked-needs-parent")
 def test_facilitate_discussion_wrapper(s):
  base={"discussionId":"d2","proposalRevision":"v4","projectSourceEntrypoint":"ROUND.md","versionedProposalRef":"ROUND.md","policySnapshotRef":"POLICY.md","purposeLineage":{"3":"exact MMD accepted","2":"two-thread review convergence","1":"shared UI/MCP design","0":"recoverable actor/repo operation"},"reviewQualityChecks":["KISS","DRY","SOLID","YAGNI"],"threads":[{"actorId":"A","threadUrl":"https://example/A","threadFunction":"impl-review"},{"actorId":"B","threadUrl":"https://example/B","threadFunction":"impl-review"}]}
  x=s.j("facilitate-discussion","--input",s.f("fac-start.json",base),"--json")
  s.assertEqual(x["classification"],"facilitation-round-send-required")
  s.assertEqual(x["missingCounterparties"],["A","B"])
  s.assertEqual(len(x["threadControls"]),2)
  s.assertIn("Project Source",x["nextAction"])
  ok=dict(base,acceptedMarkers=["exact corrected MMD accepted"],objectionMarkers=["exact corrected MMD has objections"],responses=[{"actorId":"A","proposalRevision":"v4","assistantText":"exact corrected MMD accepted"},{"actorId":"B","proposalRevision":"v4","assistantText":"proposalVersion: accepted\nexact corrected MMD accepted"}])
  x=s.j("facilitate-discussion","--input",s.f("fac-ok.json",ok),"--json")
  s.assertEqual(x["classification"],"facilitation-no-objections-confirmed")
  s.assertTrue(x["discussionComplete"])
  obj=dict(base,acceptedMarkers=["accepted"],objectionMarkers=["has objections"],responses=[{"actorId":"A","proposalRevision":"v4","assistantText":"accepted"},{"actorId":"B","proposalRevision":"v4","assistantText":"has objections","objections":[{"objectionText":"label unclear"}]}])
  x=s.j("facilitate-discussion","--input",s.f("fac-obj.json",obj),"--json")
  s.assertEqual(x["classification"],"facilitation-revision-update-required")
  s.assertEqual(x["requiredNextArtifact"],"new versioned proposal with accepted/rejected/modified objection handling")
  no_obj=dict(base,responses=[{"actorId":"A","proposalRevision":"v4","assistantText":"VERDICT_JSON: {\"verdict\":\"NO_UNRESOLVED_OBJECTIONS\"}"},{"actorId":"B","proposalRevision":"v4","assistantText":"NO_UNRESOLVED_OBJECTIONS"}])
  x=s.j("facilitate-discussion","--input",s.f("fac-no-obj.json",no_obj),"--json")
  s.assertEqual(x["classification"],"facilitation-no-objections-confirmed")
  real_obj=dict(base,responses=[{"actorId":"A","proposalRevision":"v4","assistantText":"NO_UNRESOLVED_OBJECTIONS"},{"actorId":"B","proposalRevision":"v4","assistantText":"UNRESOLVED_OBJECTIONS"}])
  x=s.j("facilitate-discussion","--input",s.f("fac-real-obj.json",real_obj),"--json")
  s.assertEqual(x["classification"],"facilitation-revision-update-required")
 def test_facilitate_discussion_requires_bootstrap_context(s):
  x=s.j("facilitate-discussion","--input",s.f("fac-missing.json",{"discussionId":"d3","proposalRevision":"v1"}),"--json")
  s.assertEqual(x["classification"],"facilitation-context-incomplete")
  s.assertIn("purposeLineage depth 3..0",x["missingFields"])
if __name__=="__main__":unittest.main()
