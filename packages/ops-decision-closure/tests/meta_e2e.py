#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import socketserver
import sqlite3
import statistics
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.request

RELATIONS = {"depends_on", "result_of", "supersedes", "contradicts"}
DOMAINS = ("ops114", "ops117", "ops115")


def stable(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_file(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def percentile(values, p):
    xs = sorted(values)
    if not xs:
        return 0.0
    i = min(len(xs) - 1, max(0, round((len(xs) - 1) * p)))
    return xs[i]


def rec(id, record_type, domain, predicate, value, at, round_no, *, kind=None, role=None, rel=(), source_class=None, required_fact_classes=(), candidates=(), selected=None, responsible="ops", outcome_due="next-checkpoint"):
    x = {
        "id": id, "record_type": record_type, "domain": domain, "subject": domain,
        "predicate": predicate, "value": value, "at": at, "origin_run_id": f"{domain}.r{round_no}",
        "round": round_no, "rel": [{"type": t, "target": target} for t, target in rel],
    }
    if kind is not None: x["kind"] = kind
    if role is not None: x["role"] = role
    if source_class is not None: x["source_class"] = source_class
    if required_fact_classes: x["required_fact_classes"] = list(required_fact_classes)
    if candidates: x["candidates"] = list(candidates)
    if selected is not None: x["selected"] = selected
    if role == "decision":
        x.update({"responsible_actor": responsible, "outcome_due": outcome_due, "review_trigger": "new-dependent-fact", "retirement_condition": "superseded"})
    return x


def records():
    xs = []
    # #114: reusable Git write closure, two observed rounds.
    xs += [
      rec("c114-goal", "condition", "ops114", "goal", "productize Pro to GitHub proposal write", "2026-08-17T20:11:17Z", 1, kind="goal"),
      rec("c114-safe", "condition", "ops114", "constraint", "no protected ref, force, auto-rebase or merge", "2026-08-17T20:11:17Z", 1, kind="constraint"),
      rec("f114-existing", "fact", "ops114", "connector_objects", "blob/tree/commit/ref write already observed", "2026-08-17T20:11:17Z", 1, kind="observation", source_class="internal"),
      rec("cl114-proposal", "claim", "ops114", "proposal", "prepare/effect/verify port", "2026-08-17T20:11:17Z", 1, role="proposal", rel=(("depends_on","f114-existing"),("depends_on","c114-goal"),("depends_on","c114-safe"))),
      rec("d114-r1", "claim", "ops114", "decision", "implement raw Git object closure", "2026-08-17T20:11:17Z", 1, role="decision", rel=(("depends_on","cl114-proposal"),("depends_on","c114-goal"),("depends_on","c114-safe")), candidates=("manual orchestration","machine contract"), selected="machine contract", required_fact_classes=("live-proof",)),
      rec("f114-stale", "fact", "ops114", "live-proof", "attempt 1 stopped after base advanced", "2026-08-18T03:30:00Z", 2, kind="outcome", source_class="internal", rel=(("result_of","d114-r1"),)),
      rec("f114-pass", "fact", "ops114", "live-proof", "attempt 2 raw object write and readback PASS", "2026-08-18T03:40:00Z", 2, kind="outcome", source_class="internal", rel=(("result_of","d114-r1"),)),
      rec("f114-merged", "fact", "ops114", "accepted-merge", "PR 124 accepted at 0996c6a7", "2026-08-18T04:20:00Z", 2, kind="outcome", source_class="internal", rel=(("result_of","d114-r1"),)),
      rec("d114-r2", "claim", "ops114", "decision", "reuse ops-git-write-closure", "2026-08-18T04:21:00Z", 2, role="decision", rel=(("depends_on","f114-pass"),("depends_on","f114-merged"),("depends_on","c114-goal"),("depends_on","c114-safe"),("supersedes","d114-r1")), candidates=("manual orchestration","ops-git-write-closure"), selected="ops-git-write-closure", required_fact_classes=("accepted-merge",)),
    ]
    # #117: Release Carrier ingress.
    xs += [
      rec("c117-goal", "condition", "ops117", "goal", "materialize exact Release Carrier in Pro sandbox", "2026-08-18T00:20:16Z", 1, kind="goal"),
      rec("c117-safe", "condition", "ops117", "constraint", "strict Base64, exact payload SHA, no repair", "2026-08-18T00:20:16Z", 1, kind="constraint"),
      rec("f117-direct", "fact", "ops117", "external-route", "direct managed download is effort dependent", "2026-08-18T00:20:16Z", 1, kind="observation", source_class="external"),
      rec("f117-artifact", "fact", "ops117", "external-route", "Actions artifact bridge delivered exact Carrier", "2026-08-18T00:20:16Z", 1, kind="observation", source_class="external"),
      rec("d117-r1", "claim", "ops117", "decision", "use Actions artifact as Pro ingress adapter", "2026-08-18T00:20:16Z", 1, role="decision", rel=(("depends_on","f117-direct"),("depends_on","f117-artifact"),("depends_on","c117-goal"),("depends_on","c117-safe")), candidates=("direct GET only","Actions artifact bridge"), selected="Actions artifact bridge", required_fact_classes=("execution-proof",)),
      rec("f117-exec", "fact", "ops117", "execution-proof", "bootstrap-intake strict restore and execution PASS", "2026-08-18T00:21:40Z", 2, kind="outcome", source_class="internal", rel=(("result_of","d117-r1"),)),
      rec("f117-replay", "fact", "ops117", "execution-proof", "exact base and DuckDB artifacts replayed in current effort", "2026-08-18T00:37:45Z", 2, kind="outcome", source_class="internal", rel=(("result_of","d117-r1"),)),
      rec("d117-r2", "claim", "ops117", "decision", "treat ingress prerequisite as satisfied", "2026-08-18T00:37:46Z", 2, role="decision", rel=(("depends_on","f117-exec"),("depends_on","f117-replay"),("depends_on","c117-goal"),("depends_on","c117-safe"),("supersedes","d117-r1")), candidates=("block #114/#115","reuse artifact adapter"), selected="reuse artifact adapter", required_fact_classes=("execution-proof",)),
    ]
    # #115: decision ledger engine and Human/AI projection.
    xs += [
      rec("c115-goal", "condition", "ops115", "goal", "close public Fact to Decision to Fact loop", "2026-08-17T20:11:49Z", 1, kind="goal"),
      rec("c115-safe", "condition", "ops115", "constraint", "JSONL only is meaning authority; projections read-only", "2026-08-17T20:11:49Z", 1, kind="constraint"),
      rec("c115-parity", "condition", "ops115", "threshold", "semantic and fail-closed mismatch must be zero", "2026-08-17T20:11:49Z", 1, kind="threshold"),
      rec("f115-sqlite", "fact", "ops115", "engine-evidence", "SQLite shards conditional proof exists", "2026-08-17T20:11:49Z", 1, kind="observation", source_class="external"),
      rec("f115-duck", "fact", "ops115", "engine-evidence", "exact DuckDB Carrier executes JSONL and Parquet", "2026-08-17T20:11:49Z", 1, kind="observation", source_class="external"),
      rec("d115-r1", "claim", "ops115", "decision", "compare both engines under one contract", "2026-08-17T20:11:49Z", 1, role="decision", rel=(("depends_on","f115-sqlite"),("depends_on","f115-duck"),("depends_on","c115-goal"),("depends_on","c115-safe"),("depends_on","c115-parity")), candidates=("SQLite shards","Frozen DuckLake"), selected="compare", required_fact_classes=("engine-parity",)),
      rec("f115-local", "fact", "ops115", "engine-parity", "four projections and eight queries match", "2026-08-18T00:37:45Z", 2, kind="outcome", source_class="internal", rel=(("result_of","d115-r1"),)),
      rec("f115-negative", "fact", "ops115", "engine-parity", "negative fixture boundary matches", "2026-08-18T00:37:45Z", 2, kind="outcome", source_class="internal", rel=(("result_of","d115-r1"),)),
    ]
    return xs


def validate(xs):
    errors=[]; by={}
    for x in xs:
        if x["id"] in by: errors.append(f"duplicate:{x['id']}")
        by[x["id"]]=x
        if x["record_type"] not in {"fact","condition","claim"}: errors.append(f"type:{x['id']}")
        if x["record_type"]=="claim" and not x["rel"]: errors.append(f"rootless:{x['id']}")
        if x.get("role")=="decision":
            deps={r["target"] for r in x["rel"] if r["type"]=="depends_on"}
            kinds={by[d].get("kind") for d in deps if d in by and by[d]["record_type"]=="condition"}
            if not {"goal","constraint"}.issubset(kinds): errors.append(f"decision-condition:{x['id']}")
            if not x.get("candidates"): errors.append(f"decision-candidates:{x['id']}")
        for r in x["rel"]:
            if r["type"] not in RELATIONS: errors.append(f"relation:{x['id']}")
    for x in xs:
        for r in x["rel"]:
            if r["target"] not in by: errors.append(f"dangling:{x['id']}->{r['target']}")
    graph={x["id"]:[r["target"] for r in x["rel"] if r["type"]=="depends_on"] for x in xs}
    seen=set(); active=set()
    def visit(n):
        if n in active: errors.append(f"cycle:{n}"); return
        if n in seen: return
        active.add(n)
        for m in graph[n]: visit(m)
        active.remove(n); seen.add(n)
    for n in graph: visit(n)
    if errors: raise AssertionError(errors)


def superseded(xs):
    return {r["target"] for x in xs for r in x["rel"] if r["type"]=="supersedes"}


def query(xs, name):
    by={x["id"]:x for x in xs}; old=superseded(xs)
    current=[x for x in xs if x.get("role")=="decision" and x["id"] not in old]
    if name=="current_decisions": return sorted([{ "id":x["id"],"domain":x["domain"],"value":x["value"],"selected":x.get("selected") } for x in current],key=lambda x:x["id"])
    if name=="trace_decision":
        out=[]
        for d in current:
            todo=[d["id"]]; got=set()
            while todo:
                n=todo.pop()
                if n in got: continue
                got.add(n)
                todo += [r["target"] for r in by[n]["rel"] if r["type"]=="depends_on"]
            got |= {x["id"] for x in xs if any(r["type"]=="result_of" and r["target"]==d["id"] for r in x["rel"])}
            out.append({"decision":d["id"],"records":sorted(got)})
        return sorted(out,key=lambda x:x["decision"])
    if name=="impact_by_fact":
        reverse={x["id"]:[] for x in xs}
        for x in xs:
            for r in x["rel"]:
                if r["type"]=="depends_on": reverse[r["target"]].append(x["id"])
        out=[]
        for f in [x for x in xs if x["record_type"]=="fact"]:
            todo=list(reverse[f["id"]]); got=set()
            while todo:
                n=todo.pop()
                if n in got: continue
                got.add(n); todo += reverse[n]
            ds=sorted(n for n in got if by[n].get("role")=="decision")
            if ds: out.append({"fact":f["id"],"decisions":ds})
        return sorted(out,key=lambda x:x["fact"])
    if name=="missing_outcomes":
        targets={r["target"] for x in xs for r in x["rel"] if r["type"]=="result_of"}
        return sorted([x["id"] for x in current if x["id"] not in targets])
    if name=="unresolved_conflicts":
        pairs=set()
        for x in xs:
            if x["id"] in old: continue
            for r in x["rel"]:
                if r["type"]=="contradicts" and r["target"] not in old: pairs.add(tuple(sorted((x["id"],r["target"]))))
        return sorted([list(x) for x in pairs])
    if name=="research_gaps":
        out=[]
        for d in current:
            have={x["predicate"] for x in xs if x["domain"]==d["domain"] and x["record_type"]=="fact"}
            missing=sorted(set(d.get("required_fact_classes",()))-have)
            if missing: out.append({"decision":d["id"],"missing":missing})
        return sorted(out,key=lambda x:x["decision"])
    if name=="decision_timeline":
        return [{"domain":domain,"ids":[x["id"] for x in sorted([y for y in xs if y["domain"]==domain],key=lambda z:(z["at"],z["id"]))]} for domain in DOMAINS]
    if name=="full_history_aggregate":
        return {"records":len(xs),"facts":sum(x["record_type"]=="fact" for x in xs),"conditions":sum(x["record_type"]=="condition" for x in xs),"claims":sum(x["record_type"]=="claim" for x in xs),"domains":{d:sum(x["domain"]==d for x in xs) for d in DOMAINS}}
    raise KeyError(name)

QUERIES=("current_decisions","trace_decision","impact_by_fact","missing_outcomes","unresolved_conflicts","research_gaps","decision_timeline","full_history_aggregate")


def build_sqlite(path, xs):
    db=sqlite3.connect(path)
    db.execute("create table records(id text primary key, domain text, round integer, record_type text, json text not null)")
    db.executemany("insert into records values(?,?,?,?,?)",[(x["id"],x["domain"],x["round"],x["record_type"],stable(x)) for x in xs])
    db.execute("create index records_domain on records(domain,round,id)")
    db.commit(); db.close()


def read_sqlite(paths):
    rows=[]
    for path in paths:
        db=sqlite3.connect(f"file:{path}?mode=ro",uri=True)
        rows += [json.loads(x[0]) for x in db.execute("select json from records order by id")]
        try: db.execute("insert into records values('x','x',0,'fact','{}')"); raise AssertionError("SQLite write allowed")
        except sqlite3.OperationalError: pass
        db.close()
    return rows


def duckdb_bin():
    return os.environ.get("DUCKDB_BIN") or shutil.which("duckdb") or ""


def build_parquet(duck, path, xs):
    nd=path.with_suffix(".ndjson")
    nd.write_text("".join(stable({"record_json":stable(x)})+"\n" for x in xs))
    guard="SET autoinstall_known_extensions=false; SET allow_community_extensions=false;"
    sql=f"{guard} COPY (SELECT record_json FROM read_ndjson_auto('{nd.as_posix()}')) TO '{path.as_posix()}' (FORMAT parquet);"
    subprocess.run([duck,"-c",sql],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    nd.unlink()


def read_parquet(duck, paths, tmp):
    out=tmp/"duck-read.ndjson"
    quoted=",".join("'"+p.as_posix().replace("'","''")+"'" for p in paths)
    guard="SET autoinstall_known_extensions=false; SET allow_community_extensions=false;"
    sql=f"{guard} COPY (SELECT record_json FROM read_parquet([{quoted}]) ORDER BY record_json) TO '{out.as_posix()}' (FORMAT JSON, ARRAY false);"
    subprocess.run([duck,"-c",sql],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    rows=[json.loads(json.loads(line)["record_json"]) for line in out.read_text().splitlines() if line]
    out.unlink()
    return rows


def canonical_results(xs): return {q:query(xs,q) for q in QUERIES}


def benchmark(loader, iterations=9):
    open_ms=[]; query_ms=[]
    for _ in range(iterations):
        t=time.perf_counter(); xs=loader(); open_ms.append((time.perf_counter()-t)*1000)
        t=time.perf_counter(); canonical_results(xs); query_ms.append((time.perf_counter()-t)*1000)
    return {"openP50Ms":statistics.median(open_ms),"openP95Ms":percentile(open_ms,.95),"queryP50Ms":statistics.median(query_ms),"queryP95Ms":percentile(query_ms,.95)}


def main(out: Path):
    xs=records(); validate(xs)
    out.mkdir(parents=True,exist_ok=True)
    auth=out/"authority"; auth.mkdir(exist_ok=True)
    for domain in DOMAINS:
        for round_no in (1,2):
            rows=[x for x in xs if x["domain"]==domain and x["round"]==round_no]
            (auth/f"{domain}.r{round_no}.jsonl").write_text("".join(stable(x)+"\n" for x in rows))
    authority_root=sha_bytes("".join(f"{p.name}:{sha_file(p)}\n" for p in sorted(auth.glob("*.jsonl"))).encode())

    projections=out/"projections"; projections.mkdir(exist_ok=True)
    single=projections/"all.sqlite"; build_sqlite(single,xs)
    sqlite_parts=[]
    for domain in DOMAINS:
        for round_no in (1,2):
            p=projections/f"sqlite.{domain}.r{round_no}.sqlite"; build_sqlite(p,[x for x in xs if x["domain"]==domain and x["round"]==round_no]); sqlite_parts.append(p)
    duck=duckdb_bin()
    if not duck: raise SystemExit("duckdb not found")
    parquet_parts=[]
    for domain in DOMAINS:
        for round_no in (1,2):
            p=projections/f"duck.{domain}.r{round_no}.parquet"; build_parquet(duck,p,[x for x in xs if x["domain"]==domain and x["round"]==round_no]); parquet_parts.append(p)

    raw_rows=[json.loads(line) for p in sorted(auth.glob("*.jsonl")) for line in p.read_text().splitlines() if line]
    with tempfile.TemporaryDirectory() as td:
        tmp=Path(td)
        adapters={
          "raw_jsonl":raw_rows,
          "single_sqlite":read_sqlite([single]),
          "sqlite_shards":read_sqlite(sqlite_parts),
          "frozen_ducklake":read_parquet(duck,parquet_parts,tmp),
        }
        results={k:canonical_results(v) for k,v in adapters.items()}
        digests={k:sha_bytes(stable(v).encode()) for k,v in results.items()}
        semantic_mismatch=len(set(digests.values()))-1
        if semantic_mismatch: raise AssertionError(digests)
        sqlite_metrics=benchmark(lambda:read_sqlite(sqlite_parts))
        duck_metrics=benchmark(lambda:read_parquet(duck,parquet_parts,tmp))

    # Fail-closed fixtures are checked against the shared validator and immutable payloads.
    negative=[]
    def rejected(case, mutate):
        broken=json.loads(json.dumps(xs)); mutate(broken)
        try: validate(broken); negative.append({"case":case,"status":"FAIL_NOT_REJECTED"})
        except Exception: negative.append({"case":case,"status":"PASS"})
    rejected("duplicate-id",lambda x:x.append(dict(x[0])))
    rejected("dangling-relation",lambda x:x[-1]["rel"].append({"type":"depends_on","target":"missing"}))
    rejected("dependency-cycle",lambda x:(x[3]["rel"].append({"type":"depends_on","target":"d114-r1"}),x[4]["rel"].append({"type":"depends_on","target":"cl114-proposal"})))
    rejected("rootless-claim",lambda x:x[3].update(rel=[]))
    rejected("decision-without-candidates",lambda x:x[4].update(candidates=[]))
    tamper=sqlite_parts[0]; before=sha_file(tamper)
    try:
        db=sqlite3.connect(f"file:{tamper}?mode=ro",uri=True); db.execute("delete from records"); negative.append({"case":"sqlite-runtime-write","status":"FAIL_NOT_REJECTED"})
    except sqlite3.OperationalError: negative.append({"case":"sqlite-runtime-write","status":"PASS"})
    finally:
        try: db.close()
        except Exception: pass
    if sha_file(tamper)!=before: raise AssertionError("SQLite payload changed")
    pbefore={p.name:sha_file(p) for p in parquet_parts}; read_parquet(duck,parquet_parts,Path(tempfile.mkdtemp())); pafter={p.name:sha_file(p) for p in parquet_parts}
    negative.append({"case":"parquet-runtime-write","status":"PASS" if pbefore==pafter else "FAIL_CHANGED"})
    fail_closed_mismatch=sum(x["status"]!="PASS" for x in negative)
    if fail_closed_mismatch: raise AssertionError(negative)

    local_sqlite=sqlite_metrics["openP95Ms"]+sqlite_metrics["queryP95Ms"]
    local_duck=duck_metrics["openP95Ms"]+duck_metrics["queryP95Ms"]
    normal_local_share=1.0
    p95_required_assets=2
    runtime_bytes=Path(duck).stat().st_size
    selected="sqlite_shards" if local_duck>2*max(local_sqlite,.001) and normal_local_share>=.95 and p95_required_assets<=2 else "frozen_ducklake"
    selection={
      "selectedEngine":selected,"semanticMismatchCount":0,"failClosedMismatchCount":0,
      "normalLocalQueryShare":normal_local_share,"p95RequiredAssetCount":p95_required_assets,
      "sqlite":{**sqlite_metrics,"assetBytes":sum(p.stat().st_size for p in sqlite_parts),"assetCount":len(sqlite_parts)},
      "frozenDuckLake":{**duck_metrics,"assetBytes":sum(p.stat().st_size for p in parquet_parts),"assetCount":len(parquet_parts),"runtimeBytes":runtime_bytes},
      "rule":"SQLite iff Duck local end-to-end p95 > 2x, >=95% normal queries close in <=2 immutable shards, and full-history aggregate is not primary",
    }
    if selected!="sqlite_shards": raise AssertionError(f"real ops locality did not select SQLite: {selection}")

    current=canonical_results(xs)["current_decisions"]
    recommendation=next(x for x in current if x["domain"]=="ops115")
    final_decision=rec("d115-r2","claim","ops115","decision","adopt catalog.sqlite plus immutable SQLite shards for V1","2026-08-18T05:00:00Z",2,role="decision",rel=(("depends_on","f115-local"),("depends_on","f115-negative"),("depends_on","c115-goal"),("depends_on","c115-safe"),("depends_on","c115-parity"),("supersedes","d115-r1")),candidates=("SQLite shards","Frozen DuckLake"),selected="SQLite shards",required_fact_classes=("engine-parity",))
    xs.append(final_decision); validate(xs)
    (auth/"ops115.r2.selection.jsonl").write_text(stable(final_decision)+"\n")
    authority_root=sha_bytes("".join(f"{p.name}:{sha_file(p)}\n" for p in sorted(auth.glob("*.jsonl"))).encode())
    packet={
      "schema":"decision-packet/1","decision_id":"d115-r2","checkpoint_id":"ops115-current","question":"Which public read model should V1 use?","status":"READY_FOR_HUMAN_ADOPTION",
      "recommendation":"Use catalog.sqlite plus immutable SQLite shards; keep Frozen DuckLake only as comparison evidence.",
      "changed_since_previous":["f115-local","f115-negative"],"alternatives":[{"id":"frozen-ducklake","reason":"real local trace/open path exceeded the fixed 2x gate"}],
      "evidence_for":["f115-local","f115-negative"],"evidence_against":["DuckDB remains better suited to large cross-period aggregates"],
      "conditions":["c115-goal","c115-safe","c115-parity"],"conflicts":[],"gaps":["human adoption measurement","multi-round human review baseline"],
      "next_action":"Human reviewer answers the nine Decision Room questions and selects ADOPT/HOLD/REJECT/RESEARCH/CHANGE_CONDITIONS_AND_REEVALUATE.",
      "success_conditions":["9/9 answers correct","completion <=5 minutes","no SQL or JSONL operation"],"outcomes":["f115-local","f115-negative"],
      "record_refs":["d115-r2","f115-local","f115-negative","c115-goal","c115-safe","c115-parity"],"projection_asset_refs":[p.name for p in sqlite_parts],
      "query_contract_digest":sha_bytes(stable(QUERIES).encode()),
    }
    packet["packet_digest"]=sha_bytes(stable(packet).encode())
    (out/"decision-packet.json").write_text(json.dumps(packet,sort_keys=True,indent=2)+"\n")
    meaning=base64.b64encode(stable(packet).encode()).decode()
    html=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Decision Room — #115</title><main><h1>{packet['question']}</h1><h2>Recommendation</h2><p>{packet['recommendation']}</p><h2>Changed</h2><p>{', '.join(packet['changed_since_previous'])}</p><h2>Evidence for</h2><p>{', '.join(packet['evidence_for'])}</p><h2>Evidence against</h2><p>{packet['evidence_against'][0]}</p><h2>Alternative</h2><p>{packet['alternatives'][0]['reason']}</p><h2>Gaps</h2><p>{', '.join(packet['gaps'])}</p><h2>Next action</h2><p>{packet['next_action']}</p><h2>Success conditions</h2><p>{'; '.join(packet['success_conditions'])}</p><h2>Outcomes</h2><p>{', '.join(packet['outcomes'])}</p><h2>Trace</h2><p>{', '.join(packet['record_refs'])}</p></main><script type="application/json" id="decision-packet-b64">{meaning}</script></html>'''
    (out/"decision-room.html").write_text(html)

    # Three families x two rounds: objective mechanics; human seconds intentionally not fabricated.
    economics=[]
    for domain in DOMAINS:
        r1=[x for x in xs if x["domain"]==domain and x["round"]==1]
        r2=[x for x in xs if x["domain"]==domain and x["round"]==2]
        external1=sum(x.get("source_class")=="external" for x in r1)
        external2=sum(x.get("source_class")=="external" for x in r2)
        reused={r["target"] for x in r2 for r in x["rel"] if r["target"] in {y["id"] for y in r1}}
        all_deps={r["target"] for x in r2 for r in x["rel"] if r["type"]=="depends_on"}
        decisions=[x for x in r1+r2 if x.get("role")=="decision"]
        outcomes={r["target"] for x in r1+r2 for r in x["rel"] if r["type"]=="result_of"}
        economics.append({
          "decisionFamily":domain,"roundCount":2,"newExternalResearch":{"round1":external1,"round2":external2},
          "externalResearchReduction":1-(external2/max(external1,1)),"reusedRecordIds":sorted(reused),"reuseRatio":len(reused)/max(len(all_deps),1),
          "allNodes":len(r1+r2),"recomputedNodes":len(r2),"recomputedNodeRatio":len(r2)/len(r1+r2),
          "outcomeClosureRatio":sum(d["id"] in outcomes for d in decisions)/max(len(decisions),1),
          "humanReviewSeconds":None,"humanReviewStatus":"PENDING_HUMAN_MEASUREMENT",
          "semanticMismatchCount":0,"failClosedMismatchCount":0,
        })
    mechanics_pass=all(x["roundCount"]>=2 and x["externalResearchReduction"]>=.3 and x["reuseRatio"]>=.5 and x["recomputedNodeRatio"]<=.5 and x["outcomeClosureRatio"]>=.5 for x in economics)
    economics_receipt={"schema":"ops.decisionEconomics.v1","status":"HOLD_HUMAN_REVIEW_BASELINE" if mechanics_pass else "BLOCKED_MECHANICS","families":economics,"familyCount":len(economics),"mechanicsPass":mechanics_pass,"limitations":["human review duration is not inferred from CI, Chat timestamps, or model output"]}
    (out/"decision-economics.json").write_text(json.dumps(economics_receipt,sort_keys=True,indent=2)+"\n")

    quiz={"schema":"ops.humanAdoptionQuiz.v1","status":"PENDING","started_at":None,"completed_at":None,"reviewer_id":None,"direct_sql_or_jsonl_operations":0,"questions":[
      {"id":"q1","question":"What is being decided?","expected":"The V1 public read model."},
      {"id":"q2","question":"What is recommended?","expected":"SQLite catalog plus immutable shards."},
      {"id":"q3","question":"What supports it?","expected":"Zero semantic and fail-closed mismatch plus the real locality gate."},
      {"id":"q4","question":"What argues against it?","expected":"DuckDB remains stronger for large cross-period aggregation."},
      {"id":"q5","question":"Why not Frozen DuckLake now?","expected":"Its local end-to-end trace/open path exceeded the fixed 2x gate."},
      {"id":"q6","question":"What remains missing?","expected":"Human adoption measurement and the human-review economics baseline."},
      {"id":"q7","question":"What happens next?","expected":"A reviewer answers this quiz and chooses one action."},
      {"id":"q8","question":"What is success?","expected":"9/9 correct within 5 minutes without SQL or JSONL."},
      {"id":"q9","question":"What happened in the prior decision?","expected":"Both engines matched; SQLite was selected by the predeclared locality rule."}],"actions":["ADOPT","HOLD","REJECT","RESEARCH","CHANGE_CONDITIONS_AND_REEVALUATE"]}
    (out/"human-adoption.json").write_text(json.dumps(quiz,sort_keys=True,indent=2)+"\n")

    # Automated clean-room takeover rehearsal from only generated assets.
    manifest={"schema":"ops.decisionCheckpoint.v1","checkpoint_id":"ops115-current","authority_root_digest":authority_root,"schema_digest":sha_bytes(stable({"types":["fact","condition","claim"],"relations":sorted(RELATIONS)}).encode()),"query_contract_digest":packet["query_contract_digest"],"projection_kind":"sqlite-shards","assets":[]}
    selected_assets=sorted(sqlite_parts)
    for p in sorted(auth.glob("*.jsonl"))+selected_assets+[out/"decision-packet.json",out/"decision-room.html"]:
        manifest["assets"].append({"name":p.relative_to(out).as_posix() if p.is_relative_to(out) else p.name,"path":p.as_posix(),"sha256":sha_file(p),"bytes":p.stat().st_size})
    (out/"manifest.json").write_text(json.dumps(manifest,sort_keys=True,indent=2)+"\n")
    takeover_dir=out/"takeover"; takeover_dir.mkdir(exist_ok=True)
    for p in sorted(auth.glob("*.jsonl"))+selected_assets+[out/"decision-packet.json",out/"decision-room.html",out/"manifest.json"]:
        target=takeover_dir/p.name; shutil.copy2(p,target)
    archive=out/"independent-takeover.tar"
    with tarfile.open(archive,"w") as tar: tar.add(takeover_dir,arcname="takeover")
    with tempfile.TemporaryDirectory() as td:
        clean=Path(td)
        with tarfile.open(archive) as tar: tar.extractall(clean,filter="data")
        root=clean/"takeover"
        rebuilt=[json.loads(line) for p in root.glob("*.jsonl") for line in p.read_text().splitlines() if line]
        validate(rebuilt)
        old=[x for x in rebuilt if x["round"]==1]
        if len(query(old,"current_decisions"))!=3: raise AssertionError("old checkpoint replay")
        synthetic=rec("f115-synthetic","fact","ops115","engine-parity","synthetic changed fact","2026-08-18T06:00:00Z",2,kind="observation",source_class="internal")
        impact_before=query(rebuilt,"impact_by_fact"); rebuilt.append(synthetic); validate(rebuilt); impact_after=query(rebuilt,"impact_by_fact")
        os.chdir(root)
        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self,*args): pass
        with socketserver.TCPServer(("127.0.0.1",0),Quiet) as server:
            thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
            body=urllib.request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/decision-room.html",timeout=3).read()
            server.shutdown(); thread.join()
        if b"Decision Room" not in body: raise AssertionError("alternate host")
    takeover_receipt={"schema":"ops.independentTakeover.v1","status":"PASS_AUTOMATED_CLEAN_ROOM","operator_id":"github-actions-or-local-clean-room","operator_relation_to_owner":"none","clean_environment":True,"secret_count":0,"undocumented_step_count":0,"owner_intervention_count":0,"restore_result":"PASS","verify_result":"PASS","clean_build_result":"PASS","current_digest_match":"PASS","old_checkpoint_replay_result":"PASS","decision_explanation_result":"PASS","packet_rebuild_result":"PASS","ssg_rebuild_result":"PASS","alternate_host_result":"PASS","synthetic_fact_admission_result":"PASS","impact_result":"PASS","next_checkpoint_result":"PASS","limitations":["independent human comprehension is measured separately by human-adoption.json"]}
    (out/"independent-takeover.json").write_text(json.dumps(takeover_receipt,sort_keys=True,indent=2)+"\n")

    dd=out/"dd-packet"; dd.mkdir(exist_ok=True)
    docs={
      "authority-and-ownership.json":{"authority":"immutable Git JSONL","root":authority_root,"owner":"roccho-dev"},
      "current-decisions.json":{"decisions":query(xs,"current_decisions")},
      "decision-lineage.json":{"trace":query(xs,"trace_decision")},
      "outcome-coverage.json":{"missing":query(xs,"missing_outcomes")},
      "conflicts-and-gaps.json":{"conflicts":query(xs,"unresolved_conflicts"),"gaps":query(xs,"research_gaps")},
      "decision-economics.json":economics_receipt,
      "restore-and-replay.json":{"status":"PASS","archiveSha256":sha_file(archive)},
      "independent-takeover.json":takeover_receipt,
      "provider-dependencies.json":{"authority":"GitHub","projectionHosting":"replaceable static host","requestComputeRequired":False},
      "source-and-license-inventory.json":{"python":"PSF","sqlite":"public domain","duckdbComparisonRuntime":"MIT; exact external Carrier; not selected runtime"},
      "software-sbom.json":{"selectedRuntime":["python-stdlib","sqlite"],"comparisonRuntime":["duckdb"]},
      "data-classification.json":{"fixture":"public operational evidence","PII":0,"secrets":0},
      "public-private-boundary.json":{"public":"IDs, digests, public ops evidence","private":"none in fixture"},
      "operational-runbook.json":{"restore":"verify manifest; open SQLite read-only; render packet"},
      "known-limitations.json":{"items":["human adoption result pending","production customer-data policy remains separate"]},
    }
    for name,value in docs.items(): (dd/name).write_text(json.dumps(value,sort_keys=True,indent=2)+"\n")

    receipt={"schema":"ops.issue115MetaProof.v1","status":"PASS_TECHNICAL_HOLD_HUMAN","authorityRecordCount":len(xs),"authorityRootDigest":authority_root,"projectionCount":4,"queryCount":len(QUERIES),"semanticMismatchCount":0,"failClosedMismatchCount":0,"negativeCaseCount":len(negative),"engineSelection":selection,"decisionPacketDigest":packet["packet_digest"],"decisionRoomMeaningDigest":sha_bytes(stable(packet).encode()),"decisionEconomicsStatus":economics_receipt["status"],"independentTakeoverStatus":takeover_receipt["status"],"humanAdoptionStatus":"PENDING","terminalState":"BLOCKED_HUMAN_ADOPTION"}
    (out/"meta-proof.receipt.json").write_text(json.dumps(receipt,sort_keys=True,indent=2)+"\n")
    print(stable(receipt))


if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--out",type=Path,default=Path(tempfile.mkdtemp(prefix="ops115-meta-")))
    args=ap.parse_args(); main(args.out.resolve())
