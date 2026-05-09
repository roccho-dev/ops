#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1];B=R/'bin'/'ops-thread-fsm';C=json.loads((R/'tests'/'fixtures'/'cases.json').read_text())
def safe(**u):
 p=dict(planComplete=True,preAuthorized=True,localBaseEvidenceValid=True,successConditionsPresent=True,failureConditionsPresent=True,gatesPresent=True,reportableEvidencePresent=True,worktreeBranchAbsent=True,noMerge=True,noPush=True,noOverwrite=True);p.update(u);return p
class T(unittest.TestCase):
 def setUp(s):s.t=tempfile.TemporaryDirectory();s.d=pathlib.Path(s.t.name)
 def tearDown(s):s.t.cleanup()
 def f(s,n,x):p=s.d/n;p.write_text(x if isinstance(x,str) else json.dumps(x));return str(p)
 def j(s,*a):return json.loads(subprocess.run([sys.executable,'-S',str(B),*a],text=True,stdout=subprocess.PIPE).stdout)
 def test_all(s):
  n=s.j('next','--state-kind','request-sent','--dry-run','--json');s.assertIn('sleep 900',n['nextAction']);s.assertFalse(n['writes']);s.assertFalse(n['sends'])
  r=s.j('classify-readback','--input',s.f('r',C['streaming']),'--phase','impl','--request-kind','work','--json');s.assertEqual(r['nextStateKind'],'sleeping-900')
  r=s.j('classify-readback','--input',s.f('i',{'text':'impl-review-pass\nok'}),'--phase','impl','--request-kind','impl-review','--json');s.assertEqual(r['classification'],'impl-review-pass')
  r=s.j('check-ready','--delivery',s.f('m',C['manifest']),'--impl-review',s.f('i2',{'text':'impl-review-pass\nok'}),'--local-gate',s.f('g',C['gate']),'--run-report',s.f('rr',C['report']),'--json');s.assertTrue(r['readyForMergeReview']);s.assertFalse(r['mergeReady'])
  r=s.j('evaluate-plan','--input',s.f('p',safe()),'--json');s.assertTrue(r['autoContinue'])
  p=safe();del p['noMerge'];s.assertEqual(s.j('evaluate-plan','--input',s.f('p2',p),'--json')['classification'],'insufficient-plan')
  s.assertEqual(s.j('evaluate-plan','--input',s.f('p3',safe(noPush=False)),'--json')['classification'],'escalation-needed')
  i=s.j('next','--state-kind','allowed-to-implement','--dry-run','--json');s.assertTrue(i['permissions']['implement']);s.assertFalse(i['permissions']['push']);s.assertFalse(i['permissions']['mergeReady'])
if __name__=='__main__':unittest.main()
