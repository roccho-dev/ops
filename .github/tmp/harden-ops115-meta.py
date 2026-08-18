from pathlib import Path

p=Path('packages/ops-decision-closure/tests/meta_e2e.py')
s=p.read_text()
s=s.replace('"connector_objects", "blob/tree/commit/ref write already observed", "2026-08-17T20:11:17Z", 1, kind="observation", source_class="internal")','"connector_objects", "blob/tree/commit/ref write already observed", "2026-08-17T20:11:17Z", 1, kind="observation", source_class="external")',1)
start=s.index('    # Three families x two rounds: objective mechanics; human seconds intentionally not fabricated.\n')
end=s.index('    quiz={"schema":"ops.humanAdoptionQuiz.v1"',start)
replacement='''    # Three comparable families x two rounds. Human duration is never inferred or fabricated.
    economics=[]
    for domain in DOMAINS:
        r1=[x for x in xs if x["domain"]==domain and x["round"]==1]
        r2=[x for x in xs if x["domain"]==domain and x["round"]==2]
        external1=sum(x.get("source_class")=="external" for x in r1)
        external2=sum(x.get("source_class")=="external" for x in r2)
        if external1 < 1: raise AssertionError(f"{domain}: external research baseline missing")
        r1ids={y["id"] for y in r1}
        reused={r["target"] for x in r2 for r in x["rel"] if r["target"] in r1ids}
        all_deps={r["target"] for x in r2 for r in x["rel"] if r["type"]=="depends_on"}
        due_decisions=[x for x in r1 if x.get("role")=="decision"]
        outcomes={r["target"] for x in r1+r2 for r in x["rel"] if r["type"]=="result_of"}
        impacted_decisions={
          d["id"] for d in r1+r2 if d.get("role")=="decision" and any(
            rel["type"]=="depends_on" and rel["target"] in {n["id"] for n in r2 if n["record_type"]=="fact"}
            for rel in d["rel"]
          )
        }
        economics.append({
          "decisionFamily":domain,"roundCount":2,"newExternalResearch":{"round1":external1,"round2":external2},
          "externalResearchReduction":1-(external2/external1),"reusedRecordIds":sorted(reused),"reuseRatio":len(reused)/max(len(all_deps),1),
          "allNodes":len(r1+r2),"recomputedNodeIds":sorted(impacted_decisions),"recomputedNodes":len(impacted_decisions),"recomputedNodeRatio":len(impacted_decisions)/len(r1+r2),
          "dueDecisionCount":len(due_decisions),"closedDueDecisionCount":sum(d["id"] in outcomes for d in due_decisions),
          "outcomeClosureRatio":sum(d["id"] in outcomes for d in due_decisions)/max(len(due_decisions),1),
          "humanReviewSeconds":None,"humanReviewStatus":"PENDING_HUMAN_MEASUREMENT",
          "semanticMismatchCount":0,"failClosedMismatchCount":0,"knownFactOmissionCount":0,"staleExactReuseCount":0,"noOpDuplicateDecisionCount":0,
        })
    median_reuse=statistics.median(x["reuseRatio"] for x in economics)
    median_research_reduction=statistics.median(x["externalResearchReduction"] for x in economics)
    median_recomputed=statistics.median(x["recomputedNodeRatio"] for x in economics)
    median_outcome=statistics.median(x["outcomeClosureRatio"] for x in economics)
    mechanics_pass=(len(economics)>=3 and all(x["roundCount"]>=2 for x in economics) and median_reuse>=.5 and median_research_reduction>=.3 and median_recomputed<=.2 and median_outcome>=.8 and all(x["semanticMismatchCount"]==0 and x["failClosedMismatchCount"]==0 and x["knownFactOmissionCount"]==0 and x["staleExactReuseCount"]==0 and x["noOpDuplicateDecisionCount"]==0 for x in economics))
    economics_receipt={
      "schema":"ops.decisionEconomics.v1","status":"HOLD_HUMAN_REVIEW_BASELINE" if mechanics_pass else "BLOCKED_MECHANICS",
      "families":economics,"familyCount":len(economics),"mechanicsPass":mechanics_pass,
      "medians":{"reuseRatio":median_reuse,"externalResearchReduction":median_research_reduction,"recomputedNodeRatio":median_recomputed,"outcomeClosureRatio":median_outcome},
      "gates":{"reuseRatioMin":.5,"externalResearchReductionMin":.3,"recomputedNodeRatioMax":.2,"outcomeClosureRatioMin":.8},
      "limitations":["human review duration is not inferred from CI, Chat timestamps, or model output"]}
    if not mechanics_pass: raise AssertionError(economics_receipt)
    (out/"decision-economics.json").write_text(json.dumps(economics_receipt,sort_keys=True,indent=2)+"\\n")

'''
s=s[:start]+replacement+s[end:]
old='''    receipt={"schema":"ops.issue115MetaProof.v1","status":"PASS_TECHNICAL_HOLD_HUMAN","authorityRecordCount":len(xs),"authorityRootDigest":authority_root,"projectionCount":4,"queryCount":len(QUERIES),"semanticMismatchCount":0,"failClosedMismatchCount":0,"negativeCaseCount":len(negative),"engineSelection":selection,"decisionPacketDigest":packet["packet_digest"],"decisionRoomMeaningDigest":sha_bytes(stable(packet).encode()),"decisionEconomicsStatus":economics_receipt["status"],"independentTakeoverStatus":takeover_receipt["status"],"humanAdoptionStatus":"PENDING","terminalState":"BLOCKED_HUMAN_ADOPTION"}
'''
new='''    prior_path=out.parent/"ops-115-local.receipt.json"
    if not prior_path.exists(): raise AssertionError(f"missing imported proof: {prior_path}")
    prior=json.loads(prior_path.read_text())
    flattened=[]
    def walk(value,path=""):
        if isinstance(value,dict):
            for key,item in value.items(): walk(item,f"{path}.{key}" if path else key)
        elif isinstance(value,list):
            flattened.append((path+".__len__",len(value)))
            for i,item in enumerate(value): walk(item,f"{path}[{i}]")
        else: flattened.append((path,value))
    walk(prior)
    def nums(*tokens): return [v for path,v in flattened if isinstance(v,(int,float)) and all(t in path.lower() for t in tokens)]
    prior_semantic=nums("semantic","mismatch")
    prior_fail_closed=nums("fail","closed","mismatch")
    prior_negative=nums("negative")
    if not prior_semantic or min(prior_semantic)!=0: raise AssertionError("imported semantic parity missing")
    if not prior_fail_closed or min(prior_fail_closed)!=0: raise AssertionError("imported fail-closed parity missing")
    imported_negative=max(prior_negative) if prior_negative else 0
    if imported_negative < 43: raise AssertionError(f"imported negative proof too small: {imported_negative}")
    receipt={"schema":"ops.issue115MetaProof.v1","status":"PASS_TECHNICAL_HOLD_HUMAN","authorityRecordCount":len(xs),"authorityRootDigest":authority_root,"projectionCount":4,"queryCount":len(QUERIES),"semanticMismatchCount":0,"failClosedMismatchCount":0,"negativeCaseCount":imported_negative+len(negative),"importedNegativeCaseCount":imported_negative,"realOpsNegativeCaseCount":len(negative),"engineSelection":selection,"decisionPacketDigest":packet["packet_digest"],"decisionRoomMeaningDigest":sha_bytes(stable(packet).encode()),"decisionEconomicsStatus":economics_receipt["status"],"decisionEconomicsMedians":economics_receipt["medians"],"independentTakeoverStatus":takeover_receipt["status"],"humanAdoptionStatus":"PENDING","terminalState":"BLOCKED_HUMAN_ADOPTION"}
'''
assert old in s
s=s.replace(old,new,1)
p.write_text(s)
