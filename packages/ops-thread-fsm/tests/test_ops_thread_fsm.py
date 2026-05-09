#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1];B=R/'bin'/'ops-thread-fsm';C=json.loads((R/'tests'/'fixtures'/'cases.json').read_text())
class T(unittest.TestCase):
 def setUp(s):s.t=tempfile.TemporaryDirectory();s.d=pathlib.Path(s.t.name)
 def tearDown(s):s.t.cleanup()
 def f(s,n,x):p=s.d/n;p.write_text(json.dumps(x));return str(p)
 def j(s,*a):r=subprocess.run([sys.executable,'-S',str(B),*a],text=True,stdout=subprocess.PIPE);return r.returncode,json.loads(r.stdout)
 def test_all(s):
  rc,j=s.j('classify-readback','--input',s.f('s',C['stream']),'--phase','impl','--request-kind','work','--json');s.assertEqual(j['nextStateKind'],'sleeping-900')
  rc,j=s.j('classify-readback','--input',s.f('c',C['candidate']),'--phase','impl','--request-kind','work','--json');s.assertEqual(j['nextStateKind'],'output-materialized')
  rc,j=s.j('classify-readback','--input',s.f('i',C['impl']),'--phase','impl','--request-kind','impl-review','--json');s.assertEqual(j['classification'],'impl-review-pass')
  rc,j=s.j('next','--state-kind','allowed-to-implement','--dry-run','--json');s.assertTrue(j['permissions']['implement']);s.assertFalse(j['permissions']['mergeReady']);s.assertFalse(j['writes']);s.assertFalse(j['sends'])
  rr=s.d/'RUN_REPORT.md';rr.write_text('ok');rc,j=s.j('check-ready','--delivery',s.f('m',C['manifest']),'--impl-review',s.f('i2',C['impl']),'--local-gate',s.f('g',{'ok':True}),'--merge-review',s.f('r',C['merge']),'--run-report',str(rr),'--json');s.assertTrue(j['ready'])
  for k,c in [('planAuto','accepted-plan'),('planNeedsAgreement','accepted-plan'),('planInsufficient','insufficient-plan'),('planRealBlocker','real-blocker'),('planFalseBlocker','false-blocker'),('planUnsupportedBlocker','insufficient-plan'),('planExternalMissing','insufficient-plan'),('planExternalComplete','accepted-plan')]:
   rc,j=s.j('evaluate-plan','--input',s.f(k,C[k]),'--json');s.assertEqual(j['classification'],c)
  s.assertTrue(s.j('evaluate-plan','--input',s.f('a',C['planAuto']),'--json')[1]['autoContinue']);s.assertFalse(s.j('evaluate-plan','--input',s.f('n',C['planNeedsAgreement']),'--json')[1]['autoContinue'])
if __name__=='__main__':unittest.main()
