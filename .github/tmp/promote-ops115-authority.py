from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import json
import shutil


def stable(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def sha(data): return hashlib.sha256(data).hexdigest()


def patch_source():
    p=Path('packages/ops-decision-closure/tests/meta_e2e.py')
    s=p.read_text()
    old='''    sqlite_parts=[]
    for domain in DOMAINS:
        for round_no in (1,2):
            p=projections/f"sqlite.{domain}.r{round_no}.sqlite"; build_sqlite(p,[x for x in xs if x["domain"]==domain and x["round"]==round_no]); sqlite_parts.append(p)
    duck=duckdb_bin()
'''
    new='''    sqlite_parts=[]
    for domain in DOMAINS:
        for round_no in (1,2):
            p=projections/f"sqlite.{domain}.r{round_no}.sqlite"; build_sqlite(p,[x for x in xs if x["domain"]==domain and x["round"]==round_no]); sqlite_parts.append(p)
    catalog=projections/"catalog.sqlite"
    db=sqlite3.connect(catalog)
    db.execute("create table shards(domain text, round integer, name text primary key, sha256 text, bytes integer)")
    db.executemany("insert into shards values(?,?,?,?,?)",[(p.name,int(p.stem.rsplit('r',1)[1]),p.name,sha_file(p),p.stat().st_size) for p in sqlite_parts])
    db.commit(); db.close()
    duck=duckdb_bin()
'''
    assert old in s
    s=s.replace(old,new,1)
    s=s.replace('"assetBytes":sum(p.stat().st_size for p in sqlite_parts),"assetCount":len(sqlite_parts)', '"assetBytes":catalog.stat().st_size+sum(p.stat().st_size for p in sqlite_parts),"assetCount":1+len(sqlite_parts),"catalogBytes":catalog.stat().st_size',1)
    s=s.replace('''    final_decision=rec("d115-r2","claim","ops115","decision","adopt catalog.sqlite plus immutable SQLite shards for V1","2026-08-18T05:00:00Z",2,role="decision",rel=(("depends_on","f115-local"),("depends_on","f115-negative"),("depends_on","c115-goal"),("depends_on","c115-safe"),("depends_on","c115-parity"),("supersedes","d115-r1")),candidates=("SQLite shards","Frozen DuckLake"),selected="SQLite shards",required_fact_classes=("engine-parity",))
    xs.append(final_decision); validate(xs)
    (auth/"ops115.r2.selection.jsonl").write_text(stable(final_decision)+"\\n")
''','''    locality_fact=rec("f115-locality","fact","ops115","engine-locality",selection,"2026-08-18T05:00:00Z",2,kind="measurement",source_class="internal",rel=(("result_of","d115-r1"),))
    final_decision=rec("d115-r2","claim","ops115","decision","adopt catalog.sqlite plus immutable SQLite shards for V1","2026-08-18T05:00:01Z",2,role="decision",rel=(("depends_on","f115-local"),("depends_on","f115-negative"),("depends_on","f115-locality"),("depends_on","c115-goal"),("depends_on","c115-safe"),("depends_on","c115-parity"),("supersedes","d115-r1")),candidates=("SQLite shards","Frozen DuckLake"),selected="SQLite shards",required_fact_classes=("engine-parity","engine-locality"))
    xs.extend([locality_fact,final_decision]); validate(xs)
    (auth/"ops115.r2.selection.jsonl").write_text(stable(locality_fact)+"\\n"+stable(final_decision)+"\\n")
    canonical_root=Path.cwd()/"decision-ledger"
    if canonical_root.exists():
        canonical=[json.loads(line) for stream in ("facts","conditions","claims") for segment in sorted((canonical_root/stream).glob("*.jsonl")) for line in segment.read_text().splitlines() if line]
        if stable(sorted(canonical,key=lambda x:x["id"]))!=stable(sorted(xs,key=lambda x:x["id"])): raise AssertionError("canonical Git JSONL differs from generated authority")
        xs=canonical
''',1)
    s=s.replace('selected_assets=sorted(sqlite_parts)','selected_assets=[catalog]+sorted(sqlite_parts)',1)
    p.write_text(s)


def promote(generated: Path):
    authority=generated/'authority'
    rows=[json.loads(line) for p in sorted(authority.glob('*.jsonl')) for line in p.read_text().splitlines() if line]
    ids=[x['id'] for x in rows]
    if len(ids)!=len(set(ids)): raise SystemExit('duplicate authority id')
    root=Path('decision-ledger')
    for stream in ('facts','conditions','claims'):
        d=root/stream
        if d.exists(): shutil.rmtree(d)
        d.mkdir(parents=True,exist_ok=True)
    type_to_stream={'fact':'facts','condition':'conditions','claim':'claims'}
    grouped={}
    for x in rows:
        key=(type_to_stream[x['record_type']],x['domain'],x['round'])
        grouped.setdefault(key,[]).append(x)
    for (stream,domain,round_no),records in sorted(grouped.items()):
        path=root/stream/f'{domain}.r{round_no}.jsonl'
        path.write_text(''.join(stable(x)+'\n' for x in sorted(records,key=lambda x:x['id'])))
    record_digest=sha(stable(sorted(rows,key=lambda x:x['id'])).encode())
    schema={
      '$schema':'https://json-schema.org/draft/2020-12/schema','title':'Decision ledger record v1','type':'object','additionalProperties':True,
      'required':['id','record_type','domain','subject','predicate','value','at','origin_run_id','round','rel'],
      'properties':{
        'id':{'type':'string','minLength':1},'record_type':{'enum':['fact','condition','claim']},'domain':{'type':'string'},'subject':{'type':'string'},'predicate':{'type':'string'},'value':{},'at':{'type':'string'},'origin_run_id':{'type':'string'},'round':{'type':'integer','minimum':1},
        'rel':{'type':'array','items':{'type':'object','additionalProperties':False,'required':['type','target'],'properties':{'type':{'enum':['depends_on','result_of','supersedes','contradicts']},'target':{'type':'string'}}}}
      }
    }
    (root/'schema').mkdir(exist_ok=True)
    (root/'schema'/'record.v1.schema.json').write_text(json.dumps(schema,sort_keys=True,indent=2)+'\n')
    queries=['current_decisions','trace_decision','impact_by_fact','missing_outcomes','unresolved_conflicts','research_gaps','decision_timeline','full_history_aggregate']
    (root/'query-contract').mkdir(exist_ok=True)
    (root/'query-contract'/'v1.json').write_text(json.dumps({'schema':'ops.decisionQueryContract.v1','queries':queries,'canonicalJson':{'sortObjectKeys':True,'arrayOrdering':'query-defined','utf8':True}},sort_keys=True,indent=2)+'\n')
    selection=json.loads((generated/'meta-proof.receipt.json').read_text())
    manifest={'schema':'ops.decisionAuthority.v1','status':'CANDIDATE_PENDING_HUMAN_ADOPTION','recordCount':len(rows),'recordSetDigest':record_digest,'streams':['facts','conditions','claims'],'selectedReadModel':selection['engineSelection']['selectedEngine'],'projectionAuthority':False,'sourceAuthority':'accepted Git JSONL after merge','currentDecisionIds':['d114-r2','d117-r2','d115-r2']}
    (root/'manifest.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
    (root/'README.md').write_text('''# Decision ledger\n\nImmutable Git JSONL segments are the only meaning authority. Facts, Conditions, and Claims are separate logical streams. Decision is `Claim(role=decision)`; Action and Outcome are Facts. SQLite, Parquet, Decision Packet, HTML, receipts, and Releases are disposable read-only projections.\n\nThe current #115 segment is a candidate until the recorded human adoption gate passes and the PR is accepted.\n''')
    dest=Path('dist/decision-room/ops115'); dest.mkdir(parents=True,exist_ok=True)
    shutil.copy2(generated/'decision-packet.json',dest/'decision-packet.json')
    shutil.copy2(generated/'decision-room.html',dest/'index.html')


def prune(out: Path):
    for name in ('projections','authority','takeover'):
        p=out/name
        if p.exists(): shutil.rmtree(p)
    for name in ('independent-takeover.tar',):
        p=out/name
        if p.exists(): p.unlink()
    # Comparison payloads are regenerated by CI/Release and are never Git authority.
    sums=[]
    for p in sorted(x for x in out.rglob('*') if x.is_file() and x.name!='SHA256SUMS'):
        sums.append(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out).as_posix()}\n')
    (out/'SHA256SUMS').write_text(''.join(sums))


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('command',choices=['patch','promote','prune']); ap.add_argument('--generated',type=Path)
    a=ap.parse_args()
    if a.command=='patch': patch_source()
    elif a.command=='promote': promote(a.generated.resolve())
    else: prune(a.generated.resolve())

if __name__=='__main__': main()
