from __future__ import annotations
import argparse
import json
from pathlib import Path

REFS = {
    'adrs': '91b11acbdec980dad12dad1f9e14363ab12ee9e2',
    'governance': '6b20ba62e5b84de7549cc1df801af453dec03a38',
    'ui': '59ba7c0370de72a790c8828994d5b726ce4cd944',
    'ops': '7da6dc51cd53bb807447f4db053f7b1d31a7f0db',
    'policy': '52500e99eb439b3703cd1678a2dcc4c6c7641112',
}

OPS_CLUSTERS = {
    'decision-policy': [
        'adrs-obligation-compiler', 'cue-append-contract-core', 'functional-core-governance-gate',
        'policy-semantic-compiler', 'shiftleft-admission', 'package-lib-level-governance',
        'structured-diagnostic', 'ops-adr-specs-promotion', 'ops-purity',
    ],
    'build-artifact': [
        'artifact-assembly', 'ops-artifact-materialize', 'ops-build-defs',
        'ops-build-receipt-check', 'dist-runner', 'mjs-bundler',
        'ops-src-runtime-pack', 'ops-portable-runtime-pack',
    ],
    'runtime-execution': [
        'gosh', 'ops-task-runtime', 'ops-cdp-core', 'hq-modeling-runtime',
        'hq-source-evidence-runtime', 'ui-raw-loop-runtime', 'ops-thread-fsm', 'prove-feat',
    ],
    'carry-handoff': [
        'chatgpt-capability', 'chatgpt-reviewer-mode-routing',
        'codex-app-browser-chatgpt-ops', 'ops-capability-loop',
        'ops-handoff-core', 'ops-handoff-pack', 'ops-knowledge-intake', 'ops-refs-vault',
    ],
    'closure-receipt': [
        'ops-decision-closure', 'ops-git-write-closure', 'ops-gov-package-output',
        'ops-issue-ledger', 'ops-package-responses', 'ops-readme-artifact',
        'ops-runbook-checks', 'ops-specsless-readiness',
    ],
    'discovery-delivery': [
        'billing-channel-config', 'excalidraw', 'find-packages', 'gov-release-proxy',
        'jsonl-inspect', 'model-source-reconcile', 'ops-selfcontained-poc',
        'package-architecture-map',
    ],
}
UI_PACKAGES = [
    'a2ui-adapter-artifacts', 'a2ui-browser', 'artifact-invocation', 'artifact-reference',
    'connectability', 'core-port', 'decision-packet', 'semantic-map-profiles',
    'semantic-map', 'ui-claims', 'ui-projection-evidence', 'ui-receipts', 'url-module',
]
GOV_PACKAGES = ['repo-governance-cli', 'repo-governance']

rows: list[dict] = []

def add(row: dict) -> None:
    rows.append(row)

def region(id: str, parent: str|None, label: str, kind: str, bounds: list[int], summary: str, *, href: str|None=None, value=None, complete: bool|None=None, temporal: tuple[str,int,int]|None=None):
    r = {'type':'region','id':id,'parent':parent,'label':label,'kind':kind,'bounds':bounds,'summary':summary}
    if href: r['href']=href
    if value is not None: r['value']=value
    if complete is not None: r['set']={'complete':complete}
    if temporal is not None:
        actor,start,end=temporal
        r['temporal']={'actor':actor,'ordinal':{'start':start,'end':end}}
    add(r)

def relation(id: str, fr: str, to: str, kind: str, label: str):
    add({'type':'relation','id':id,'from':fr,'to':to,'kind':kind,'label':label})

add({'type':'meta','schema':'semantic-map-state/1','root':'organization-world','title':'Internal Organization Semantic Map — current factory chain'})
region('organization-world',None,'current organization world','root',[0,0,6900,6200],
       'ADRS → Governance/Policy → UI → Ops factory → staging evidence. Generated projection; authority:false. Missing and unknown remain visible.',complete=False)

# ADRS
region('repo:adrs','organization-world','ADRS — decisions / authority','actor',[50,50,1550,1600],
       f'Observed at proposals@{REFS["adrs"][:12]}. Decision authority surface; #331 and #332 are open.',href='https://github.com/roccho-dev/adrs',complete=False)
region('group:adrs:decisions','repo:adrs','decision lineage','package-group',[100,140,1450,650],
       'Issue declaration and repository-enforced accepted-record candidate.',complete=False)
region('decision:adrs#331','group:adrs:decisions','ADRS #331 — organization map goal','task',[140,220,650,200],
       'Top-level declaration. State observed: OPEN. It is not a completion receipt.',href='https://github.com/roccho-dev/adrs/issues/331',value='open',temporal=('repo:adrs',0,0))
region('decision-pr:adrs#332','group:adrs:decisions','ADRS #332 — accepted-record candidate','task',[850,220,650,200],
       'Architecture/ownership/staging authorization candidate. State observed: OPEN, not merged.',href='https://github.com/roccho-dev/adrs/pull/332',value='open',temporal=('repo:adrs',1,1))
region('gap:accepted-record','group:adrs:decisions','GAP — #332 is not accepted','task',[140,480,1360,220],
       'Mutable Issue prose cannot substitute for merged accepted meaning. Downstream completion remains blocked.',href='https://github.com/roccho-dev/adrs/pull/332',value='blocking',temporal=('repo:adrs',2,2))
region('group:adrs:contract','repo:adrs','repository-enforced contract surfaces','package-group',[100,840,1450,700],
       'Observed ADRS surfaces. These are not packages and their full semantics are not inferred here.',complete=False)
region('surface:adrs:adr-src','group:adrs:contract','adr/src — decision records','surface',[140,930,420,210],
       f'Directory surface observed at {REFS["adrs"][:12]}; contents remain ADRS authority.',href=f'https://github.com/roccho-dev/adrs/tree/{REFS["adrs"]}/adr/src')
region('surface:adrs:allowed-uris','group:adrs:contract','adr/allowed.cue — URI admission','surface',[590,930,420,210],
       'Repository whitelist paired with accepted CUE decisions.',href=f'https://github.com/roccho-dev/adrs/blob/{REFS["adrs"]}/adr/allowed.cue')
region('surface:adrs:approval-actor','group:adrs:contract','approval_actor — authority contract','surface',[1040,930,420,210],
       'Observed authority/approval contract surface; no extra meaning inferred.',href=f'https://github.com/roccho-dev/adrs/tree/{REFS["adrs"]}/approval_actor')
region('surface:adrs:authority-boundary','group:adrs:contract','Authority boundary','surface',[140,1190,1320,230],
       'Accepted meaning stays in ADRS. Governance/UI/Ops outputs shown here are projections or evidence, not decision authority.',value='authority-boundary')

# Governance
region('repo:governance','organization-world','Governance — deterministic current join','actor',[1650,50,1550,1600],
       f'Observed at proposals@{REFS["governance"][:12]}. Exact packages/* inventory has 2 directories.',href='https://github.com/roccho-dev/governance',complete=False)
region('group:governance:packages','repo:governance','packages/* — 2 observed','package-group',[1700,140,1450,650],
       'Exact first-level packages directory inventory at the pinned revision. Responsibility/conformance not inferred.',complete=True)
for i,name in enumerate(GOV_PACKAGES):
    x=1750+i*700
    temporal = ('repo:governance',3,3) if name=='repo-governance' else None
    region(f'package:governance:{name}','group:governance:packages',name,'package',[x,230,650,220],
           f'packages/{name} observed at governance@{REFS["governance"][:12]}; responsibility and conformance remain unknown.',
           href=f'https://github.com/roccho-dev/governance/tree/{REFS["governance"]}/packages/{name}',value='observed',temporal=temporal)
region('tool:governance:control-surface-binder','group:governance:packages','controlSurface.bundle binder','task',[1750,500,650,220],
       'Exact-byte/kind/source-ref binder exists only on open Governance PR #210.',href='https://github.com/roccho-dev/governance/pull/210',value='candidate',temporal=('repo:governance',4,4))
region('work:governance#210','group:governance:packages','Governance PR #210','task',[2450,500,650,220],
       'Current-world bundle work. State observed: OPEN / DRAFT; not accepted or merged.',href='https://github.com/roccho-dev/governance/pull/210',value='draft',temporal=('repo:governance',5,5))
region('group:governance:state','repo:governance','current state and coverage','package-group',[1700,840,1450,700],
       'Projection state must preserve every missing/unknown/drift/conflict row.',complete=False)
region('surface:governance:gov-release','group:governance:state','gov release / package-output transport','surface',[1750,930,650,210],
       'Merged transport surface exists; it is not the complete #331 organization bundle.',href='https://github.com/roccho-dev/governance/pull/206',value='merged')
region('surface:governance:non-authority','group:governance:state','authority:false projection','surface',[2450,930,650,210],
       'Governance joins current observations deterministically but does not replace ADRS authority.',value='non-authority')
region('gap:complete-universe','group:governance:state','GAP — complete repository/package universe','task',[1750,1180,1350,240],
       'Selected relevant repositories are shown, but owner-wide active-repository classification is not yet proven.',href='https://github.com/roccho-dev/governance/pull/210',value='blocking',temporal=('repo:governance',6,6))

# Policy and deploy
region('repo:policy','organization-world','Policy — bootstrap only','actor',[3250,50,900,760],
       f'Observed at main@{REFS["policy"][:12]}. Repository contains README.md only.',href='https://github.com/roccho-dev/policy',complete=False)
region('surface:policy:readme','repo:policy','README.md','surface',[3300,160,800,210],
       'Only observed repository content at the pinned revision; no policy package or enforcement claim.',href=f'https://github.com/roccho-dev/policy/blob/{REFS["policy"]}/README.md',value='observed')
region('gap:policy-bootstrap','repo:policy','GAP — policy implementation absent','gap',[3300,420,800,260],
       'The repository is a placeholder. Ops policy-related packages must not be misrepresented as policy authority.',value='blocking')

region('repo:deploy','organization-world','Deploy — empty repository','actor',[3250,860,900,790],
       'Repository exists but has no branch/content. Delivery currently remains an Ops provider effect.',href='https://github.com/roccho-dev/deploy',complete=False)
region('surface:deploy:empty','repo:deploy','no branch / no package','surface',[3300,970,800,220],
       'Observed empty repository; no deployment implementation is invented.',value='empty')
region('gap:deploy-repo-empty','repo:deploy','GAP — deploy ownership not materialized','gap',[3300,1240,800,260],
       'Cloud deployment proof is currently Ops-owned; deploy repository ownership remains unresolved.',value='unknown')

# UI
region('repo:ui','organization-world','UI — Semantic Map renderer','actor',[4250,50,2600,1600],
       f'Observed at proposals@{REFS["ui"][:12]}. Exact packages/* inventory has 13 directories.',href='https://github.com/roccho-dev/ui',complete=False)
region('group:ui:packages','repo:ui','packages/* — 13 observed','package-group',[4300,140,2500,1180],
       'Exact first-level packages directory inventory at the pinned revision. Package responsibilities are not inferred.',complete=True)
ux=[4360,5150,5940]; uy=[240,450,660,870,1080]
for i,name in enumerate(UI_PACKAGES):
    x=ux[i%3]; y=uy[i//3]
    temporal=None
    if name=='semantic-map-profiles': temporal=('repo:ui',7,7)
    if name=='semantic-map': temporal=('repo:ui',8,8)
    region(f'package:ui:{name}','group:ui:packages',name,'package',[x,y,720,170],
           f'packages/{name} observed at ui@{REFS["ui"][:12]}; responsibility/conformance not inferred.',
           href=f'https://github.com/roccho-dev/ui/tree/{REFS["ui"]}/packages/{name}',value='observed',temporal=temporal)
region('work:ui#181','repo:ui','UI PR #181 — prior profile fixture','task',[4300,1370,750,200],
       'Merged prior package-output profile evidence; not the complete #331 current bundle.',href='https://github.com/roccho-dev/ui/pull/181',value='merged',temporal=('repo:ui',7,7))
region('view:semantic-map:map-graph-seq','repo:ui','map/1 · graph/1 · seq/1','surface',[5100,1370,750,200],
       'One renderer core projects the same semantic IDs into spatial, graph, and sequence views.',value='available')
region('gap:ui-current-bundle','repo:ui','GAP — #331 bundle not consumed','task',[5900,1370,900,200],
       'UI currently has the renderer/profile packages, but no merged complete current organization bundle.',value='blocking',temporal=('repo:ui',9,9))

# Ops
region('repo:ops','organization-world','Ops — AI factory / package inventory','actor',[50,1750,6800,3650],
       f'Observed at proposals@{REFS["ops"][:12]}. Exact packages/* inventory has 49 directories.',href='https://github.com/roccho-dev/ops',complete=False)
cluster_positions={
    'decision-policy':(100,1880), 'build-artifact':(2300,1880), 'runtime-execution':(4500,1880),
    'carry-handoff':(100,3200), 'closure-receipt':(2300,3200), 'discovery-delivery':(4500,3200),
}
cluster_labels={
    'decision-policy':'decision / policy experiments',
    'build-artifact':'build / artifact',
    'runtime-execution':'runtime / execution',
    'carry-handoff':'carry / handoff',
    'closure-receipt':'closure / receipts',
    'discovery-delivery':'discovery / delivery',
}
ordinal_for={
    'ops-gov-package-output':10,
    'artifact-assembly':11,
    'gov-release-proxy':12,
}
for cluster,names in OPS_CLUSTERS.items():
    gx,gy=cluster_positions[cluster]
    region(f'group:ops:{cluster}','repo:ops',cluster_labels[cluster],'package-group',[gx,gy,2100,1250],
           'Name-derived navigation grouping only; all listed package directories are exact observations at the pinned revision.',complete=True)
    for i,name in enumerate(names):
        x=gx+50+(i%2)*1020; y=gy+150+(i//2)*205
        temporal=('repo:ops',ordinal_for[name],ordinal_for[name]) if name in ordinal_for else None
        region(f'package:ops:{name}',f'group:ops:{cluster}',name,'package',[x,y,930,170],
               f'packages/{name} observed at ops@{REFS["ops"][:12]}; responsibility, adoption, and conformance are not inferred.',
               href=f'https://github.com/roccho-dev/ops/tree/{REFS["ops"]}/packages/{name}',value='observed',temporal=temporal)

region('group:ops:delivery-proof','repo:ops','bounded staging delivery / readback','package-group',[100,4520,6500,760],
       'Provider effect and receipts. This lane is visual-evaluation only and remains authority:false.',complete=False)
region('effect:ops:staging-deploy','group:ops:delivery-proof','Cloudflare staging deployment','task',[180,4640,1400,210],
       'Bounded read-only branch alias. This is a provider effect, not production cutover.',value='candidate',temporal=('repo:ops',13,13))
region('evidence:ops:byte-readback','group:ops:delivery-proof','exact remote byte readback','task',[1700,4640,1400,210],
       'Remote index.html and JSONL must byte-match local deterministic materialization.',value='required',temporal=('repo:ops',14,14))
region('evidence:ops:browser-readback','group:ops:delivery-proof','real Chromium depiction readback','task',[3220,4640,1400,210],
       'Map, graph, sequence, focus views, labels, relations, and console state must be checked remotely.',value='required',temporal=('repo:ops',15,15))
region('gap:terminal-closure','group:ops:delivery-proof','GAP — #331 terminal closure','task',[4740,4640,1780,210],
       'Even a green staging depiction does not close #331 while accepted record and complete current bundle remain open.',href='https://github.com/roccho-dev/adrs/issues/331',value='blocking',temporal=('repo:ops',16,16))
region('surface:ops:claim-ceiling','group:ops:delivery-proof','claim ceiling','surface',[180,4920,6340,220],
       'Proves only exact visual evaluation of observed surfaces. Does not prove all packages conform, production readiness, or business outcome.',value='visual-evaluation-only')

# Global explicit gaps
region('group:global-gaps','organization-world','explicit residuals — never hidden','package-group',[50,5500,6800,600],
       'The projection is useful only if its unclosed world boundary remains visible.',complete=False)
region('gap:owner-wide-universe','group:global-gaps','GAP — owner-wide repository universe','gap',[100,5620,2100,320],
       'This view deliberately limits itself to ADRS/Governance/Policy/UI/Ops/Deploy. The owner account contains other repositories not yet classified into this organization surface.',value='blocking')
region('gap:package-responsibility','group:global-gaps','GAP — package responsibility','gap',[2300,5620,2100,320],
       'Directory existence is observed; package responsibility/owner/excludes are not inferred from names.',value='unknown')
region('gap:package-conformance','group:global-gaps','GAP — implementation / receipt conformity','gap',[4500,5620,2250,320],
       'Package nodes are not green claims. Per-package obligations, implementations, examples, receipts, waivers, and residuals still require an accepted join.',value='unknown')

# One temporal handoff chain; same IDs are reused across all three projections.
chain=[
 ('decision:adrs#331','decision-pr:adrs#332','requires accepted record'),
 ('decision-pr:adrs#332','package:governance:repo-governance','authorizes current join'),
 ('package:governance:repo-governance','tool:governance:control-surface-binder','feeds binder'),
 ('tool:governance:control-surface-binder','work:governance#210','implemented by'),
 ('work:governance#210','package:ui:semantic-map-profiles','projects into profile'),
 ('package:ui:semantic-map-profiles','package:ui:semantic-map','renders with core'),
 ('package:ui:semantic-map','package:ops:ops-gov-package-output','binds package output'),
 ('package:ops:ops-gov-package-output','package:ops:artifact-assembly','assembles artifact'),
 ('package:ops:artifact-assembly','package:ops:gov-release-proxy','delivers through'),
 ('package:ops:gov-release-proxy','effect:ops:staging-deploy','provider effect'),
 ('effect:ops:staging-deploy','evidence:ops:byte-readback','verified by'),
 ('evidence:ops:byte-readback','evidence:ops:browser-readback','followed by'),
 ('evidence:ops:browser-readback','gap:terminal-closure','cannot exceed claim ceiling'),
]
for i,(fr,to,label) in enumerate(chain): relation(f'rel:handoff:{i:02d}',fr,to,'handoff',label)
for i,gap in enumerate(['gap:accepted-record','gap:complete-universe','gap:ui-current-bundle','gap:terminal-closure','gap:owner-wide-universe','gap:package-responsibility','gap:package-conformance']):
    relation(f'rel:block:{i:02d}',gap,'decision:adrs#331','blocks','blocks closure')
relation('rel:policy-boundary','gap:policy-bootstrap','package:ops:policy-semantic-compiler','contrasts','Ops experiment is not policy authority')
relation('rel:deploy-boundary','effect:ops:staging-deploy','gap:deploy-repo-empty','reveals','delivery ownership unresolved')

# Canonical one-object-per-line. Preserve semantic order: meta, regions, relations.
parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(''.join(json.dumps(row,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n' for row in rows),encoding='utf-8',newline='\n')

ops=[r for r in rows if r.get('type')=='region' and str(r.get('id','')).startswith('package:ops:')]
ui=[r for r in rows if r.get('type')=='region' and str(r.get('id','')).startswith('package:ui:')]
gov=[r for r in rows if r.get('type')=='region' and str(r.get('id','')).startswith('package:governance:')]
assert len(ops)==49, len(ops)
assert len(ui)==13, len(ui)
assert len(gov)==2, len(gov)
assert len({r['id'] for r in rows if 'id' in r})==len([r for r in rows if 'id' in r])
print(json.dumps({'rows':len(rows),'regions':sum(r['type']=='region' for r in rows),'relations':sum(r['type']=='relation' for r in rows),'opsPackages':len(ops),'uiPackages':len(ui),'governancePackages':len(gov)},sort_keys=True))
