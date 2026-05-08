#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1];B=R/"bin"/"ops-thread-fsm";C=json.loads((R/"tests"/"fixtures"/"cases.json").read_text())
class T(unittest.TestCase):
 def setUp(s):s.t=tempfile.TemporaryDirectory();s.d=pathlib.Path(s.t.name)
 def tearDown(s):s.t.cleanup()
 def f(s,n,x):p=s.d/n;p.write_text(x if isinstance(x,str) else json.dumps(x,ensure_ascii=False));return str(p)
 def cli(s,*a):return subprocess.run([sys.executable,"-S",str(B),*a],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 def cl(s,k,r="work"):return json.loads(s.cli("classify-readback","--input",s.f(k+".json",C[k]),"--phase","impl","--request-kind",r,"--json").stdout)
 def test_classify(s):s.assertEqual(s.cl("streaming")["nextStateKind"],"sleeping-900");s.assertEqual(s.cl("done")["classification"],"output-missing");s.assertEqual(s.cl("candidate")["nextStateKind"],"output-materialized");s.assertTrue(s.cl("reject","impl-review")["retry"]);s.assertEqual(s.cl("implpass","impl-review")["classification"],"impl-review-pass");s.assertEqual(s.cl("mergepass","merge-review")["classification"],"merge-review-pass");s.assertEqual(s.cl("fail","merge-review")["classification"],"local-gate-fail")
 def test_ready(s):
  p=s.cli("check-ready","--delivery",s.f("m.json",C["manifest"]),"--impl-review",s.f("i.json",C["implpass"]),"--local-gate",s.f("g.json",C["gate"]),"--merge-review",s.f("mr.json",C["mergepass"]),"--run-report",s.f("RUN_REPORT.md",C["report"]),"--json");s.assertEqual(p.returncode,0);s.assertTrue(json.loads(p.stdout)["ready"])
  p=s.cli("check-ready","--delivery",s.f("m2.json",C["manifest"]),"--impl-review",s.f("i2.json",C["implpass"]),"--local-gate",s.f("g2.json",C["gate"]),"--merge-review",s.f("mr2.json",C["mergepass"]),"--json");s.assertNotEqual(p.returncode,0);s.assertFalse(json.loads(p.stdout)["ready"])
 def test_dry_run(s):n=json.loads(s.cli("next","--state-kind","request-sent","--dry-run","--json").stdout);s.assertFalse(n["writes"]);s.assertFalse(n["sends"]);s.assertIn("sleep 900",n["nextAction"]);s.assertIn("delivery-verified",s.cli("render-prompt","--phase","impl","--request-kind","work").stdout)
if __name__=="__main__":unittest.main()
