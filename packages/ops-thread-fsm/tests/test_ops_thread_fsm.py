#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1];B=R/"bin"/"ops-thread-fsm";C=json.loads((R/"tests"/"fixtures"/"cases.json").read_text())
class T(unittest.TestCase):
 def setUp(s):s.t=tempfile.TemporaryDirectory();s.d=pathlib.Path(s.t.name)
 def tearDown(s):s.t.cleanup()
 def f(s,n,x):p=s.d/n;p.write_text(x if isinstance(x,str) else json.dumps(x,ensure_ascii=False));return str(p)
 def cli(s,*a):return subprocess.run([sys.executable,"-S",str(B),*a],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 def cl(s,k,r="work"):return json.loads(s.cli("classify-readback","--input",s.f(k+".json",C[k]),"--phase","impl","--request-kind",r,"--json").stdout)
 def test_classify(s):s.assertEqual(s.cl("streaming")["nextStateKind"],"sleeping-900");s.assertEqual(s.cl("done")["classification"],"output-missing");s.assertEqual(s.cl("candidate")["nextStateKind"],"output-materialized");s.assertTrue(s.cl("reject","review")["retry"]);s.assertEqual(s.cl("fail","review")["classification"],"local-gate-fail")
 def test_ready(s):
  p=s.cli("check-ready","--materialize-manifest",s.f("m.json",C["manifest"]),"--review",s.f("r.json",C["pass"]),"--local-gate",s.f("g.json",C["gate"]),"--run-report",s.f("RUN_REPORT.md",C["report"]),"--json");s.assertEqual(p.returncode,0);s.assertTrue(json.loads(p.stdout)["ready"])
  p=s.cli("check-ready","--materialize-manifest",s.f("m2.json",C["manifest"]),"--review",s.f("r2.json",C["pass"]),"--local-gate",s.f("g2.json",C["gate"]),"--json");s.assertNotEqual(p.returncode,0);s.assertFalse(json.loads(p.stdout)["ready"])
 def test_dry_run(s):n=json.loads(s.cli("next","--state-kind","request-sent","--dry-run","--json").stdout);s.assertFalse(n["writes"]);s.assertFalse(n["sends"]);s.assertIn("sleep 900",n["nextAction"]);s.assertIn("ops-artifact-materialize",s.cli("render-prompt","--phase","impl","--request-kind","work").stdout)
if __name__=="__main__":unittest.main()
