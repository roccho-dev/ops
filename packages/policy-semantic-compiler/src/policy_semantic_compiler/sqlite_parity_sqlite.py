from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from .sqlite_parity_contract import (
    DETAIL_SPECS,
    OPTIONAL_FILES,
    PROVIDER_GATE_IDS,
    REQUIRED_FILES,
    ProofError,
    bool_int,
    optional_rows,
    strict_rows,
    trace,
    write_json,
    write_jsonl,
)

def sqlite_candidate(records_dir: Path, out_dir: Path, policy_rev: str) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    missing = [str(records_dir / filename) for filename in REQUIRED_FILES.values() if not (records_dir / filename).exists()]
    if missing:
        gates = [{"gate_id": "adrs-required-record-files-present", "status": "blocked", "blocker": "missing required ADRS projection record files", "details": missing}]
        write_jsonl(out_dir / "adrs-projection-sqlite-gates.jsonl", gates)
        write_json(out_dir / "manifest.json", {
            "kind": "policySemantic.adrsProjectionSqliteReview.v1",
            "ok": False,
            "status": "blocked",
            "semanticCoverageReady": False,
            "cutoverReady": False,
            "policyDeletionApproved": False,
            "generatedIsAuthority": False,
            "sqliteExecuted": False,
            "blockers": ["missing required ADRS projection record files"],
            "outputs": {"gates": "adrs-projection-sqlite-gates.jsonl"},
        })
        return 1

    try:
        source_files = strict_rows(records_dir / REQUIRED_FILES["source_files"], "source_files")
        source_spans = strict_rows(records_dir / REQUIRED_FILES["source_spans"], "source_spans")
        semantic_nodes = strict_rows(records_dir / REQUIRED_FILES["semantic_nodes"], "semantic_nodes")
        semantic_edges = strict_rows(records_dir / REQUIRED_FILES["semantic_edges"], "semantic_edges")
        span_dispositions = strict_rows(records_dir / REQUIRED_FILES["span_dispositions"], "span_dispositions")
        coverage_proofs = strict_rows(records_dir / REQUIRED_FILES["coverage_proofs"], "coverage_proofs")
        fresh_genx_reviews = strict_rows(records_dir / REQUIRED_FILES["fresh_genx_reviews"], "fresh_genx_reviews")
        dispositions = optional_rows(records_dir / OPTIONAL_FILES["dispositions"], "dispositions")
        unsupported_provider_files = [filename for key, filename in OPTIONAL_FILES.items() if key != "dispositions" and (records_dir / filename).exists()]
        if unsupported_provider_files:
            raise ProofError("optional review-provider records require the current Python post-gate reducer: " + ",".join(sorted(unsupported_provider_files)))
    except (OSError, ProofError) as exc:
        gates = [{"gate_id": "sqlite-import-valid", "status": "blocked", "blocker": str(exc), "count": 1}]
        write_jsonl(out_dir / "adrs-projection-sqlite-gates.jsonl", gates)
        write_json(out_dir / "manifest.json", {
            "kind": "policySemantic.adrsProjectionSqliteReview.v1",
            "ok": False,
            "status": "blocked",
            "semanticCoverageReady": False,
            "cutoverReady": False,
            "policyDeletionApproved": False,
            "generatedIsAuthority": False,
            "sqliteExecuted": False,
            "policyRev": policy_rev,
            "blockers": [str(exc)],
            "outputs": {"gates": "adrs-projection-sqlite-gates.jsonl"},
        })
        return 1

    db_path = out_dir / "adrs-projection.sqlite3"
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(
            """
            PRAGMA foreign_keys = OFF;
            CREATE TABLE source_files(id TEXT PRIMARY KEY, path TEXT NOT NULL);
            CREATE TABLE source_spans(id TEXT PRIMARY KEY, source_file_id TEXT NOT NULL, rev TEXT, path TEXT, start_line INTEGER, end_line INTEGER);
            CREATE TABLE semantic_nodes(id TEXT PRIMARY KEY, rev TEXT);
            CREATE TABLE semantic_node_spans(node_id TEXT NOT NULL, span_id TEXT NOT NULL, PRIMARY KEY(node_id, span_id));
            CREATE TABLE semantic_edges(id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, rev TEXT);
            CREATE TABLE semantic_edge_spans(edge_id TEXT NOT NULL, span_id TEXT NOT NULL, PRIMARY KEY(edge_id, span_id));
            CREATE TABLE dispositions(id TEXT PRIMARY KEY, source_file_id TEXT NOT NULL, status TEXT NOT NULL, requires_individual INTEGER NOT NULL);
            CREATE TABLE span_dispositions(id TEXT PRIMARY KEY, accepted INTEGER NOT NULL, status TEXT NOT NULL, policy_rev TEXT NOT NULL, disposition TEXT NOT NULL, fixture_only INTEGER NOT NULL, generated_authority INTEGER NOT NULL, deletion_approved INTEGER NOT NULL);
            CREATE TABLE span_disposition_spans(disposition_id TEXT NOT NULL, span_id TEXT NOT NULL, PRIMARY KEY(disposition_id, span_id));
            CREATE TABLE coverage_proofs(id TEXT PRIMARY KEY, accepted INTEGER NOT NULL, status TEXT NOT NULL, policy_rev TEXT NOT NULL, no_objections INTEGER NOT NULL, fixture_only INTEGER NOT NULL, generated_authority INTEGER NOT NULL, deletion_approved INTEGER NOT NULL);
            CREATE TABLE coverage_proof_spans(proof_id TEXT NOT NULL, span_id TEXT NOT NULL, PRIMARY KEY(proof_id, span_id));
            CREATE TABLE coverage_proof_genx(proof_id TEXT NOT NULL, genx_id TEXT NOT NULL, PRIMARY KEY(proof_id, genx_id));
            CREATE TABLE fresh_genx_reviews(id TEXT PRIMARY KEY, status TEXT NOT NULL, policy_rev TEXT NOT NULL, no_objections INTEGER NOT NULL, memory_used INTEGER NOT NULL, body_used INTEGER NOT NULL, fixture_only INTEGER NOT NULL);
            """
        )
        conn.executemany("INSERT INTO source_files(id,path) VALUES(?,?)", [(r["id"], r["path"]) for r in source_files])
        conn.executemany(
            "INSERT INTO source_spans(id,source_file_id,rev,path,start_line,end_line) VALUES(?,?,?,?,?,?)",
            [(r["id"], r["sourceFileId"], trace(r).get("rev"), trace(r).get("path"), trace(r).get("startLine"), trace(r).get("endLine")) for r in source_spans],
        )
        conn.executemany("INSERT INTO semantic_nodes(id,rev) VALUES(?,?)", [(r["id"], trace(r).get("rev")) for r in semantic_nodes])
        conn.executemany("INSERT INTO semantic_node_spans(node_id,span_id) VALUES(?,?)", [(r["id"], span_id) for r in semantic_nodes for span_id in r["sourceSpanIds"]])
        conn.executemany("INSERT INTO semantic_edges(id,from_id,to_id,rev) VALUES(?,?,?,?)", [(r["id"], r["from"], r["to"], trace(r).get("rev")) for r in semantic_edges])
        conn.executemany("INSERT INTO semantic_edge_spans(edge_id,span_id) VALUES(?,?)", [(r["id"], span_id) for r in semantic_edges for span_id in r["sourceSpanIds"]])
        conn.executemany("INSERT INTO dispositions(id,source_file_id,status,requires_individual) VALUES(?,?,?,?)", [(r["id"], r["sourceFileId"], r["status"], bool_int(r["requiresIndividualSemanticApproval"])) for r in dispositions])
        conn.executemany(
            "INSERT INTO span_dispositions(id,accepted,status,policy_rev,disposition,fixture_only,generated_authority,deletion_approved) VALUES(?,?,?,?,?,?,?,?)",
            [(r["id"], bool_int(r["accepted"]), r["status"], r["policyRev"], r["disposition"], bool_int(r["fixtureOnly"]), bool_int(r["generatedIsAuthority"]), bool_int(r["policyDeletionApproved"])) for r in span_dispositions],
        )
        conn.executemany("INSERT INTO span_disposition_spans(disposition_id,span_id) VALUES(?,?)", [(r["id"], span_id) for r in span_dispositions for span_id in r["sourceSpanIds"]])
        conn.executemany(
            "INSERT INTO coverage_proofs(id,accepted,status,policy_rev,no_objections,fixture_only,generated_authority,deletion_approved) VALUES(?,?,?,?,?,?,?,?)",
            [(r["id"], bool_int(r["accepted"]), r["status"], r["policyRev"], bool_int(r["noRemainingObjections"]), bool_int(r["fixtureOnly"]), bool_int(r["generatedIsAuthority"]), bool_int(r["policyDeletionApproved"])) for r in coverage_proofs],
        )
        conn.executemany("INSERT INTO coverage_proof_spans(proof_id,span_id) VALUES(?,?)", [(r["id"], span_id) for r in coverage_proofs for span_id in r["coveredSourceSpanIds"]])
        conn.executemany("INSERT INTO coverage_proof_genx(proof_id,genx_id) VALUES(?,?)", [(r["id"], genx_id) for r in coverage_proofs for genx_id in r["freshGenXEvidenceIds"]])
        conn.executemany(
            "INSERT INTO fresh_genx_reviews(id,status,policy_rev,no_objections,memory_used,body_used,fixture_only) VALUES(?,?,?,?,?,?,?)",
            [(r["id"], r["status"], r["policyRev"], bool_int(r["noRemainingObjections"]), bool_int(r["memoryUsed"]), bool_int(r["policyBodyUsedAsSource"]), bool_int(r["fixtureOnly"])) for r in fresh_genx_reviews],
        )
        conn.commit()
        if conn.execute("SELECT json_valid('{\"x\":1}')").fetchone()[0] != 1:
            raise ProofError("SQLite JSON capability is unavailable")

        conn.executescript(
            """
            CREATE TEMP VIEW endpoint_ids AS
              SELECT id FROM source_files UNION SELECT id FROM source_spans UNION SELECT id FROM semantic_nodes;
            CREATE TEMP VIEW accepted_span_dispositions AS
              SELECT * FROM span_dispositions
              WHERE accepted=1 AND status='accepted' AND policy_rev=:policy_rev AND fixture_only=0 AND generated_authority=0 AND deletion_approved=0;
            """.replace(":policy_rev", "'" + policy_rev.replace("'", "''") + "'")
        )
        conn.executescript(
            """
            CREATE TEMP VIEW accepted_span_ids AS
              SELECT DISTINCT s.span_id AS id FROM span_disposition_spans s JOIN accepted_span_dispositions d ON d.id=s.disposition_id;
            CREATE TEMP VIEW accepted_non_normative_span_ids AS
              SELECT DISTINCT s.span_id AS id FROM span_disposition_spans s JOIN accepted_span_dispositions d ON d.id=s.disposition_id
              WHERE d.disposition IN ('non-normative','duplicate','superseded','retired');
            CREATE TEMP VIEW non_normative_span_ids AS
              SELECT ss.id FROM source_spans ss JOIN dispositions d ON d.source_file_id=ss.source_file_id
              WHERE d.status='accepted' AND d.requires_individual=0
              UNION SELECT id FROM accepted_non_normative_span_ids;
            CREATE TEMP VIEW review_required_spans AS SELECT id FROM source_spans EXCEPT SELECT id FROM non_normative_span_ids;
            CREATE TEMP VIEW coverage_candidates AS
              SELECT * FROM coverage_proofs WHERE accepted=1 AND status='accepted' AND policy_rev='""" + policy_rev.replace("'", "''") + """';
            CREATE TEMP VIEW accepted_fresh_genx_reviews AS
              SELECT * FROM fresh_genx_reviews WHERE status='accepted' AND policy_rev='""" + policy_rev.replace("'", "''") + """'
                AND no_objections=1 AND memory_used=0 AND body_used=0 AND fixture_only=0;
            CREATE TEMP VIEW accepted_coverage_proofs AS
              SELECT c.* FROM coverage_candidates c
              WHERE c.no_objections=1 AND c.fixture_only=0 AND c.generated_authority=0 AND c.deletion_approved=0
                AND EXISTS (SELECT 1 FROM coverage_proof_genx p JOIN accepted_fresh_genx_reviews g ON g.id=p.genx_id WHERE p.proof_id=c.id);
            CREATE TEMP VIEW covered_span_ids AS
              SELECT DISTINCT s.span_id AS id FROM coverage_proof_spans s JOIN accepted_coverage_proofs p ON p.id=s.proof_id;
            """
        )

        def count(sql: str, params: tuple[Any, ...] = ()) -> int:
            return int(conn.execute(sql, params).fetchone()[0])

        gates: list[dict[str, Any]] = []
        def add_gate(gate_id: str, n: int, blocker: str | None, positive: bool = False) -> None:
            passed = n > 0 if positive else n == 0
            gates.append({"gate_id": gate_id, "status": "pass" if passed else "blocked", "blocker": None if passed else blocker, "count": n})

        gates.append({"gate_id": "adrs-projection-sqlite-executed", "status": "pass", "blocker": None, "count": 0})
        gates.append({"gate_id": "adrs-required-record-files-present", "status": "pass", "blocker": None, "count": 0})
        add_gate("policy-ref-current", count("SELECT COUNT(*) FROM (SELECT id FROM source_spans WHERE rev IS NULL OR rev<>? UNION ALL SELECT id FROM semantic_nodes WHERE rev IS NULL OR rev<>? UNION ALL SELECT id FROM semantic_edges WHERE rev IS NULL OR rev<>?)", (policy_rev, policy_rev, policy_rev)), "ADRS projection row has stale or missing policy rev")
        add_gate("orphan-span-source-file", count("SELECT COUNT(*) FROM source_spans ss LEFT JOIN source_files sf ON sf.id=ss.source_file_id WHERE sf.id IS NULL"), "sourceSpan.sourceFileId does not resolve")
        add_gate("orphan-node-source-span", count("SELECT COUNT(*) FROM semantic_node_spans ns LEFT JOIN source_spans ss ON ss.id=ns.span_id WHERE ss.id IS NULL"), "semanticNode.sourceSpanIds contains missing sourceSpan")
        add_gate("orphan-edge-endpoint", count("SELECT COUNT(*) FROM (SELECT from_id endpoint FROM semantic_edges UNION ALL SELECT to_id endpoint FROM semantic_edges) e LEFT JOIN endpoint_ids p ON p.id=e.endpoint WHERE p.id IS NULL"), "semanticEdge endpoint does not resolve")
        add_gate("orphan-edge-source-span", count("SELECT COUNT(*) FROM semantic_edge_spans es LEFT JOIN source_spans ss ON ss.id=es.span_id WHERE ss.id IS NULL"), "semanticEdge.sourceSpanIds contains missing sourceSpan")
        add_gate("orphan-span-without-node", count("SELECT COUNT(*) FROM review_required_spans r LEFT JOIN semantic_node_spans n ON n.span_id=r.id WHERE n.span_id IS NULL"), "review-required sourceSpan has no semanticNode coverage")
        add_gate("accepted-coverage-proof-present", count("SELECT COUNT(*) FROM accepted_coverage_proofs"), "accepted coverage proof is missing", positive=True)
        add_gate("accepted-span-disposition-missing", count("SELECT COUNT(*) FROM source_spans ss LEFT JOIN accepted_span_ids d ON d.id=ss.id WHERE d.id IS NULL"), "sourceSpan lacks accepted span disposition")
        add_gate("accepted-coverage-missing", count("SELECT COUNT(*) FROM review_required_spans r LEFT JOIN covered_span_ids c ON c.id=r.id WHERE c.id IS NULL"), "review-required sourceSpan is not covered by accepted coverage proof")
        missing_genx = count("SELECT COUNT(*) FROM (SELECT 'accepted-fresh-genx-missing' id WHERE NOT EXISTS(SELECT 1 FROM accepted_fresh_genx_reviews) UNION ALL SELECT c.id FROM coverage_candidates c WHERE NOT EXISTS(SELECT 1 FROM coverage_proof_genx p JOIN accepted_fresh_genx_reviews g ON g.id=p.genx_id WHERE p.proof_id=c.id))")
        add_gate("fresh-genx-evidence-accepted", missing_genx, "accepted Fresh GenX no-objection evidence is missing or not linked from coverage proof")
        add_gate("fixture-only-proof-rejected", count("SELECT COUNT(*) FROM coverage_candidates WHERE fixture_only=1"), "fixture-only proof cannot satisfy accepted coverage")
        add_gate("candidate-only-disposition", count("SELECT COUNT(*) FROM dispositions d WHERE d.status<>'accepted' AND EXISTS(SELECT 1 FROM source_spans ss LEFT JOIN accepted_span_ids a ON a.id=ss.id WHERE ss.source_file_id=d.source_file_id AND a.id IS NULL)"), "candidate disposition cannot satisfy accepted coverage")
        add_gate("candidate-only-span-disposition", count("SELECT COUNT(*) FROM span_dispositions WHERE status<>'accepted'"), "candidate span disposition cannot satisfy accepted coverage")
        add_gate("span-disposition-missing-source-span", count("SELECT COUNT(*) FROM span_disposition_spans d LEFT JOIN source_spans s ON s.id=d.span_id WHERE s.id IS NULL"), "span disposition references missing sourceSpan")
        add_gate("contradictory-disposition", count("SELECT COUNT(*) FROM (SELECT source_file_id FROM dispositions GROUP BY source_file_id HAVING COUNT(DISTINCT status || ':' || CAST(requires_individual AS TEXT))>1)"), "multiple dispositions for one source file conflict")
        add_gate("generated-rows-not-authority", count("SELECT COUNT(*) FROM (SELECT generated_authority, deletion_approved FROM coverage_proofs UNION ALL SELECT generated_authority, deletion_approved FROM span_dispositions) WHERE generated_authority<>0 OR deletion_approved<>0"), "projection/generated row claimed authority")

        missing_span_rows = [dict(row) for row in conn.execute("SELECT ss.id sourceSpanId, ss.source_file_id sourceFileId, ss.path sourcePath, ss.start_line startLine, ss.end_line endLine FROM source_spans ss LEFT JOIN accepted_span_ids d ON d.id=ss.id WHERE d.id IS NULL ORDER BY sourcePath,startLine,sourceSpanId")]
        missing_coverage_rows = [dict(row) for row in conn.execute("SELECT s.id sourceSpanId, s.source_file_id sourceFileId, s.path sourcePath, s.start_line startLine, s.end_line endLine FROM review_required_spans r JOIN source_spans s ON s.id=r.id LEFT JOIN covered_span_ids c ON c.id=r.id WHERE c.id IS NULL ORDER BY sourcePath,startLine,sourceSpanId")]
        candidate_span_rows = []
        source_span_ids_by_disposition: dict[str, list[str]] = {}
        for row in conn.execute("SELECT disposition_id, span_id FROM span_disposition_spans ORDER BY disposition_id,span_id"):
            source_span_ids_by_disposition.setdefault(row[0], []).append(row[1])
        for row in conn.execute("SELECT id,status,accepted,policy_rev,disposition FROM span_dispositions WHERE status<>'accepted' ORDER BY id"):
            candidate_span_rows.append({"dispositionId": row[0], "status": row[1], "accepted": bool(row[2]), "policyRev": row[3], "disposition": row[4], "sourceSpanIds": source_span_ids_by_disposition.get(row[0], [])})
        candidate_file_rows = [dict(row) for row in conn.execute("SELECT d.id dispositionId,d.source_file_id sourceFileId,d.status status,d.requires_individual requiresIndividualSemanticApproval FROM dispositions d WHERE d.status<>'accepted' AND EXISTS(SELECT 1 FROM source_spans ss LEFT JOIN accepted_span_ids a ON a.id=ss.id WHERE ss.source_file_id=d.source_file_id AND a.id IS NULL) ORDER BY sourceFileId,dispositionId")]

        missing_span_ids = {str(row["sourceSpanId"]) for row in missing_span_rows}
        provider_gates: list[dict[str, Any]] = []
        for gate_id in PROVIDER_GATE_IDS:
            if gate_id == "review-batches-cover-missing-accepted-spans":
                n = len(missing_span_ids)
                blocker = "review batches do not exactly cover missing accepted source spans"
            else:
                n = 0
                blocker = None
            provider_gates.append({"gate_id": gate_id, "status": "pass" if n == 0 else "blocked", "blocker": blocker if n else None, "count": n})
        gates.extend(provider_gates)

        for filename, kind in DETAIL_SPECS.items():
            rows = {
                "missing-accepted-span-dispositions.jsonl": missing_span_rows,
                "missing-accepted-coverage.jsonl": missing_coverage_rows,
                "candidate-only-span-dispositions.jsonl": candidate_span_rows,
                "candidate-only-file-dispositions.jsonl": candidate_file_rows,
            }[filename]
            write_jsonl(out_dir / filename, [dict(row, kind=kind, rowNumber=i) for i, row in enumerate(rows, start=1)])
        write_jsonl(out_dir / "review-provider-gates.jsonl", provider_gates)
        write_jsonl(out_dir / "adrs-projection-sqlite-gates.jsonl", gates)
        ok = bool(gates) and all(row["status"] == "pass" for row in gates)
        blockers = [row["blocker"] for row in gates if row["status"] != "pass" and row.get("blocker")]
        write_json(out_dir / "manifest.json", {
            "kind": "policySemantic.adrsProjectionSqliteReview.v1",
            "ok": ok,
            "status": "accepted" if ok else "blocked",
            "semanticCoverageReady": ok,
            "cutoverReady": False,
            "policyDeletionApproved": False,
            "generatedIsAuthority": False,
            "sqliteExecuted": True,
            "policyRev": policy_rev,
            "blockers": blockers,
            "outputs": {
                "gates": "adrs-projection-sqlite-gates.jsonl",
                "missingAcceptedSpanDispositions": "missing-accepted-span-dispositions.jsonl",
                "missingAcceptedCoverage": "missing-accepted-coverage.jsonl",
                "candidateOnlySpanDispositions": "candidate-only-span-dispositions.jsonl",
                "candidateOnlyFileDispositions": "candidate-only-file-dispositions.jsonl",
                "reviewProviderGates": "review-provider-gates.jsonl",
                "database": "adrs-projection.sqlite3",
            },
        })
        return 0 if ok else 1
    except (sqlite3.Error, ProofError) as exc:
        gates = [{"gate_id": "sqlite-executed", "status": "blocked", "blocker": str(exc), "count": 1}]
        write_jsonl(out_dir / "adrs-projection-sqlite-gates.jsonl", gates)
        write_json(out_dir / "manifest.json", {
            "kind": "policySemantic.adrsProjectionSqliteReview.v1",
            "ok": False,
            "status": "blocked",
            "semanticCoverageReady": False,
            "cutoverReady": False,
            "policyDeletionApproved": False,
            "generatedIsAuthority": False,
            "sqliteExecuted": False,
            "policyRev": policy_rev,
            "blockers": [str(exc)],
            "outputs": {"gates": "adrs-projection-sqlite-gates.jsonl"},
        })
        return 1
    finally:
        conn.close()

