#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1];B=R/"bin"/"ops-thread-fsm";C=json.loads((R/"tests"/"fixtures"/"cases.json").read_text())
class T(unittest.TestCase):
 def setUp(s):s.t=tempfile.TemporaryDirectory();s.d=pathlib.Path(s.t.name)
 def tearDown(s):s.t.cleanup()
 def f(s,n,x):p=s.d/n;p.write_text(x if isinstance(x,str) else json.dumps(x,ensure_ascii=False));return str(p)
 def cli(s,*a):return subprocess.run([sys.executable,"-S",str(B),*a],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 def cl(s,k,r="work"):return json.loads(s.cli("classify-readback","--input",s.f(k+".json",C[k]),"--phase","impl","--request-kind",r,"--json").stdout)
 def ready(s,delivery="manifest",impl="implpass",merge="mergepass",report=True):
  a=["check-ready","--delivery",s.f("m.json",C[delivery]),"--impl-review",s.f("i.json",C[impl]),"--local-gate",s.f("g.json",C["gate"]),"--merge-review",s.f("mr.json",C[merge]),"--json"]
  if report:a += ["--run-report",s.f("RUN_REPORT.md",C["report"])]
  return s.cli(*a)
 def test_classify(s):
  s.assertEqual(s.cl("streaming")["nextStateKind"],"sleeping-900");s.assertEqual(s.cl("done")["classification"],"output-missing");s.assertEqual(s.cl("candidate")["nextStateKind"],"output-materialized");s.assertTrue(s.cl("reject","impl-review")["retry"]);s.assertEqual(s.cl("implpass","impl-review")["classification"],"impl-review-pass");s.assertEqual(s.cl("mergepass","merge-review")["classification"],"merge-review-pass");s.assertEqual(s.cl("fail","merge-review")["classification"],"local-gate-fail")
 def test_gate_specific_reviews(s):
  s.assertNotEqual(s.cl("genericpass","impl-review")["classification"],"impl-review-pass");s.assertNotEqual(s.cl("wrongForMerge","merge-review")["classification"],"merge-review-pass");s.assertNotEqual(s.cl("implneg","impl-review")["classification"],"impl-review-pass")
 def test_ready_requires_all(s):
  p=s.ready();s.assertEqual(p.returncode,0);s.assertTrue(json.loads(p.stdout)["ready"])
  for kwargs in [dict(impl="genericpass"),dict(impl="mergepass",merge="implpass"),dict(delivery="manifestShallow"),dict(delivery="manifestZero"),dict(delivery="manifestBadSha"),dict(report=False)]:
   p=s.ready(**kwargs);s.assertNotEqual(p.returncode,0);s.assertFalse(json.loads(p.stdout)["ready"])
 def test_dry_run_and_prompt(s):
  n=json.loads(s.cli("next","--state-kind","request-sent","--dry-run","--json").stdout);s.assertFalse(n["writes"]);s.assertFalse(n["sends"]);s.assertIn("sleep 900",n["nextAction"]);out=s.cli("render-prompt","--phase","impl","--request-kind","impl-review").stdout;s.assertIn("delivery-verified",out);s.assertIn("impl-review-pass",out)
if __name__=="__main__":unittest.main()
