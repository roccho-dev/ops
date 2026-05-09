#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1];B=R/"bin"/"ops-thread-fsm";C=json.loads((R/"tests"/"fixtures"/"cases.json").read_text())
class T(unittest.TestCase):
 def setUp(s):s.t=tempfile.TemporaryDirectory();s.d=pathlib.Path(s.t.name)
 def tearDown(s):s.t.cleanup()
 def f(s,n,x):p=s.d/n;p.write_text(x if isinstance(x,str) else json.dumps(x,ensure_ascii=False));return str(p)
 def cli(s,*a):return subprocess.run([sys.executable,"-S",str(B),*a],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 def cl(s,k,r="work"):return json.loads(s.cli("classify-readback","--input",s.f(k+".json",C[k]),"--phase","impl","--request-kind",r,"--json").stdout)
 def cltxt(s,rk,x,phase="impl"):return json.loads(s.cli("classify-readback","--input",s.f(rk+".json",{"text":x}),"--phase",phase,"--request-kind",rk,"--json").stdout)
 def ready(s,delivery="manifest",impl="impl-review-pass\naccepted",merge="merge-review-pass\naccepted",report=True):
  a=["check-ready","--delivery",s.f("m.json",C[delivery]),"--impl-review",s.f("i.json",{"text":impl}),"--local-gate",s.f("g.json",C["gate"]),"--merge-review",s.f("mr.json",{"text":merge}),"--json"]
  if report:a += ["--run-report",s.f("RUN_REPORT.md",C["report"])]
  return s.cli(*a)
 def test_classify(s):
  s.assertEqual(s.cl("streaming")["nextStateKind"],"sleeping-900");s.assertEqual(s.cl("done")["classification"],"output-missing");s.assertEqual(s.cl("candidate")["nextStateKind"],"output-materialized");s.assertTrue(s.cl("reject","impl-review")["retry"]);s.assertEqual(s.cltxt("impl-review","impl-review-pass\naccepted")["classification"],"impl-review-pass");s.assertEqual(s.cltxt("merge-review","merge-review-pass\naccepted","merge")["classification"],"merge-review-pass");s.assertEqual(s.cl("fail","merge-review")["classification"],"local-gate-fail")
 def test_ready_requires_all(s):
  p=s.ready();s.assertEqual(p.returncode,0);s.assertTrue(json.loads(p.stdout)["ready"])
  for kwargs in [dict(impl="review-pass 合格"),dict(impl="merge-review-pass\naccepted",merge="impl-review-pass\naccepted"),dict(delivery="manifestShallow"),dict(delivery="manifestZero"),dict(delivery="manifestBadSha"),dict(report=False)]:
   p=s.ready(**kwargs);s.assertNotEqual(p.returncode,0);s.assertFalse(json.loads(p.stdout)["ready"])
 def test_dry_run_and_prompt(s):
  n=json.loads(s.cli("next","--state-kind","request-sent","--dry-run","--json").stdout);s.assertFalse(n["writes"]);s.assertFalse(n["sends"]);s.assertIn("sleep 900",n["nextAction"]);out=s.cli("render-prompt","--phase","impl","--request-kind","work").stdout;s.assertIn("delivery-verified",out);s.assertIn("impl-review-pass",out)
 def test_review_pass_requires_first_non_empty_gate_specific_verdict(s):
  s.assertEqual(s.cltxt("impl-review","impl-review-pass\nbody")["classification"],"impl-review-pass")
  s.assertEqual(s.cltxt("merge-review","verdict: merge-review-pass\nbody","merge")["classification"],"merge-review-pass")
  for bad in ["do not emit impl-review-pass","`impl-review-pass` ではない","not accepted as impl-review-pass","The review does not pass","review-pass 合格","pass","passed","合格"]:
   s.assertNotEqual(s.cltxt("impl-review",bad)["classification"],"impl-review-pass")
  for bad in ["do not emit merge-review-pass","`merge-review-pass` ではない","not accepted as merge-review-pass","impl-review-pass mixed into merge-review","review-pass 合格","pass","passed","合格"]:
   s.assertNotEqual(s.cltxt("merge-review",bad,"merge")["classification"],"merge-review-pass")
 def test_check_ready_uses_strict_review_verdicts(s):
  p=s.ready("manifest","impl-review-pass\naccepted","merge-review-pass\naccepted");s.assertEqual(p.returncode,0);s.assertTrue(json.loads(p.stdout)["ready"])
  for impl,merge in [("review-pass 合格","merge-review-pass\naccepted"),("impl-review-pass\naccepted","impl-review-pass\naccepted"),("merge-review-pass\naccepted","impl-review-pass\naccepted"),("The review does not pass; do not emit impl-review-pass","merge-review-pass\naccepted")]:
   p=s.ready("manifest",impl,merge);s.assertNotEqual(p.returncode,0);s.assertFalse(json.loads(p.stdout)["ready"])
if __name__=="__main__":unittest.main()
