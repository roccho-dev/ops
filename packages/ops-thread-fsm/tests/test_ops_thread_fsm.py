#!/usr/bin/env python3
import json,pathlib,subprocess,sys,tempfile,unittest
R=pathlib.Path(__file__).resolve().parents[1]; B=R/'bin'/'ops-thread-fsm'; C=json.loads((R/'tests'/'fixtures'/'cases.json').read_text())
A='a'*64; Z='b'*64

def safe(**kw):
 p=dict(planComplete=True,preAuthorized=True,localBaseEvidenceValid=True,noOverwrite=True,noMerge=True,noPush=True,worktreeBranchAbsent=True,successConditionsPresent=True,failureConditionsPresent=True,gatesPresent=True,reportableEvidencePresent=True); p.update(kw); return p

class T(unittest.TestCase):
 def setUp(s): s.t=tempfile.TemporaryDirectory(); s.d=pathlib.Path(s.t.name)
 def tearDown(s): s.t.cleanup()
 def f(s,n,x): p=s.d/n; p.write_text(x if isinstance(x,str) else json.dumps(x,ensure_ascii=False)); return str(p)
 def cli(s,*a): return subprocess.run([sys.executable,'-S',str(B),*a],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 def cr(s,x,rk='work',ph='impl'): return json.loads(s.cli('classify-readback','--input',s.f('r.json',x),'--phase',ph,'--request-kind',rk,'--json').stdout)
 def pl(s,x): return json.loads(s.cli('evaluate-plan','--input',s.f('p.json',x),'--json').stdout)
 def ready(s,delivery=None,impl='impl-review-pass\nok',merge=None,report=True,target='ready-for-merge-review'):
  a=['check-ready','--delivery',s.f('m.json',delivery or C['manifest']),'--impl-review',s.f('i.json',{'text':impl}),'--local-gate',s.f('g.json',C['gate']),'--target',target,'--json']
  if merge is not None: a += ['--merge-review',s.f('mr.json',{'text':merge})]
  if report: a += ['--run-report',s.f('RUN_REPORT.md',C['report'])]
  return s.cli(*a)
 def badm(s,k):
  r={'ok':True,'path':'x','bytes':1,'bytesExpected':1,'sha256':A,'sha256Expected':A,'fileIndex':1,'fileCount':1}
  if k=='path': r['path']=''
  if k=='bytes': r['bytes']=2
  if k=='sha': r['sha256Expected']=Z
  if k=='idx': return {'ok':True,'count':2,'rows':[r|{'fileCount':2},r|{'path':'y','sha256':Z,'sha256Expected':Z,'fileIndex':1,'fileCount':2}]}
  return {'ok':True,'count':1,'rows':[r]}
 def test_readback_and_review_verdicts(s):
  s.assertEqual(s.cr(C['streaming'])['nextStateKind'],'sleeping-900'); s.assertEqual(s.cr(C['done'])['classification'],'output-missing'); s.assertEqual(s.cr(C['candidate'])['nextStateKind'],'output-materialized'); s.assertTrue(s.cr(C['reject'],'impl-review')['retry'])
  s.assertEqual(s.cr({'text':'impl-review-pass\nbody'},'impl-review')['classification'],'impl-review-pass'); s.assertEqual(s.cr({'text':'verdict: merge-review-pass\nbody'},'merge-review','merge')['classification'],'merge-review-pass')
  for x in ['do not emit impl-review-pass','`impl-review-pass` mention','not accepted as impl-review-pass','review-pass 合格','pass','passed','合格','merge-review-pass']: s.assertNotEqual(s.cr({'text':x},'impl-review')['classification'],'impl-review-pass')
  for x in ['do not emit merge-review-pass','`merge-review-pass` mention','not accepted as merge-review-pass','impl-review-pass mixed','review-pass 合格','pass','passed','合格']: s.assertNotEqual(s.cr({'text':x},'merge-review','merge')['classification'],'merge-review-pass')
 def test_ready_delivery_and_merge_separation(s):
  j=json.loads(s.ready().stdout); s.assertTrue(j['readyForMergeReview']); s.assertFalse(j['mergeReady']); s.assertEqual(j['stateKind'],'ready-for-merge-review')
  j=json.loads(s.ready(merge='merge-review-pass\nok',target='merge-ready').stdout); s.assertTrue(j['mergeReady'])
  for kw in [dict(impl='review-pass 合格'),dict(impl='merge-review-pass\nok'),dict(delivery=C['manifestShallow']),dict(delivery=C['manifestZero']),dict(delivery=C['manifestBadSha']),dict(delivery=s.badm('path')),dict(delivery=s.badm('bytes')),dict(delivery=s.badm('idx')),dict(report=False)]:
   r=s.ready(**kw); s.assertNotEqual(r.returncode,0); s.assertFalse(json.loads(r.stdout)['readyForMergeReview'])
  for impl,merge in [('impl-review-pass\nok','impl-review-pass\nok'),('do not emit impl-review-pass','merge-review-pass\nok'),('impl-review-pass\nok','review-pass 合格')]:
   r=s.ready(impl=impl,merge=merge,target='merge-ready'); s.assertNotEqual(r.returncode,0); s.assertFalse(json.loads(r.stdout)['mergeReady'])
 def test_plan_blockers_escalation_external(s):
  j=s.pl(safe()); s.assertEqual(j['nextStateKind'],'state-allowed-to-proceed-without-extra-user-agreement'); s.assertTrue(j['autoContinue'])
  j=s.pl(safe(preAuthorized=False)); s.assertEqual(j['nextStateKind'],'state-requiring-user-gen0-agreement'); s.assertFalse(j['autoContinue'])
  s.assertEqual(s.pl({'planComplete':True})['classification'],'insufficient-plan'); s.assertEqual(s.pl({'blockerClaim':'cannot connect','blockerEvidence':True})['classification'],'real-blocker'); s.assertEqual(s.pl({'blockerClaim':'thread not created','readbackDisprovesBlocker':True})['classification'],'false-blocker'); s.assertNotEqual(s.pl({'blockerClaim':'not sent'})['classification'],'real-blocker')
  for upd,ev in [({'noMerge':False},'merge-scope'),({'noPush':False},'push-scope'),({'noOverwrite':False},'overwrite-scope'),({'mergeRequested':True},'merge-scope'),({'pushRequested':True},'push-scope'),({'overwriteRequested':True},'overwrite-scope')]:
   j=s.pl(safe(**upd)); s.assertEqual(j['classification'],'escalation-needed'); s.assertEqual(j['nextStateKind'],'escalation-needed'); s.assertIn(ev,j['evidence'])
  s.assertEqual(s.pl(safe(externalThreadWork=True,sendConfirmation=True,readback=True))['classification'],'insufficient-plan')
  s.assertEqual(s.pl(safe(externalThreadWork=True,sendConfirmationEvidence='sent',readbackEvidence='rb'))['classification'],'accepted-plan')
 def test_permissions_and_next(s):
  for st in 'real-blocker false-blocker insufficient-plan accepted-plan state-requiring-user-gen0-agreement escalation-needed'.split():
   j=json.loads(s.cli('next','--state-kind',st,'--dry-run','--json').stdout); s.assertFalse(j['writes']); s.assertFalse(j['sends']); s.assertTrue(j['nextAction'])
  j=json.loads(s.cli('next','--state-kind','allowed-to-implement','--dry-run','--json').stdout); s.assertTrue(j['permissions']['implement'])
  for k in 'createWorktree returnArtifact sendReview mergeReady canonicalMerge push overwrite'.split(): s.assertFalse(j['permissions'][k])
  for st,k in [('allowed-to-create-worktree','createWorktree'),('allowed-to-return-artifact','returnArtifact'),('allowed-to-send-review','sendReview'),('ready-for-merge-review','readyForMergeReview'),('merge-ready','mergeReady')]: s.assertTrue(json.loads(s.cli('next','--state-kind',st,'--dry-run','--json').stdout)['permissions'][k])
  out=s.cli('render-prompt','--phase','impl','--request-kind','work').stdout
  for x in ['ready-for-merge-review','merge-ready','no-overwrite','concrete send']: s.assertIn(x,out)
if __name__=='__main__': unittest.main()
