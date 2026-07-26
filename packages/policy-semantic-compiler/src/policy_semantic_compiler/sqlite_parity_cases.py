from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Callable

from .sqlite_parity_contract import Case, OPTIONAL_FILES, REQUIRED_FILES, read_jsonl_loose, write_jsonl

def mutate_jsonl(path: Path, fn: Callable[[list[dict[str, Any]]], None]) -> None:
    rows = read_jsonl_loose(path)
    fn(rows)
    write_jsonl(path, rows)


def no_change(_: Path) -> None:
    return


def remove_required(filename: str) -> Callable[[Path], None]:
    return lambda root: (root / filename).unlink()


def malformed(filename: str) -> Callable[[Path], None]:
    return lambda root: (root / filename).write_text('{"id":\n', encoding="utf-8")


def empty(filename: str) -> Callable[[Path], None]:
    return lambda root: (root / filename).write_text("", encoding="utf-8")


def mutate_first(filename: str, fn: Callable[[dict[str, Any]], None]) -> Callable[[Path], None]:
    def mutate(root: Path) -> None:
        mutate_jsonl(root / filename, lambda rows: fn(rows[0]))
    return mutate


def duplicate_first(filename: str) -> Callable[[Path], None]:
    def mutate(root: Path) -> None:
        mutate_jsonl(root / filename, lambda rows: rows.append(copy.deepcopy(rows[0])))
    return mutate


def add_file_dispositions(rows: list[dict[str, Any]]) -> Callable[[Path], None]:
    def mutate(root: Path) -> None:
        write_jsonl(root / OPTIONAL_FILES["dispositions"], rows)
    return mutate


def reverse_jsonl(filename: str) -> Callable[[Path], None]:
    def mutate(root: Path) -> None:
        mutate_jsonl(root / filename, lambda rows: rows.reverse())
    return mutate


def compose(*mutations: Callable[[Path], None]) -> Callable[[Path], None]:
    def mutate(root: Path) -> None:
        for item in mutations:
            item(root)
    return mutate


def build_cases() -> list[Case]:
    return [
        Case("accepted-fixture", no_change),
        Case("missing-required-file", remove_required(REQUIRED_FILES["source_files"])),
        Case("malformed-jsonl", malformed(REQUIRED_FILES["source_spans"])),
        Case("empty-jsonl", empty(REQUIRED_FILES["source_spans"])),
        Case("duplicate-id", duplicate_first(REQUIRED_FILES["source_spans"])),
        Case("stale-revision", mutate_first(REQUIRED_FILES["semantic_nodes"], lambda row: row["sourceTrace"].update(rev="rev-old"))),
        Case("missing-accepted-proof", mutate_first(REQUIRED_FILES["coverage_proofs"], lambda row: row.update(accepted=False, status="candidate"))),
        Case("fake-proof", mutate_first(REQUIRED_FILES["coverage_proofs"], lambda row: row.update(generatedIsAuthority=True))),
        Case("fixture-only-proof", mutate_first(REQUIRED_FILES["coverage_proofs"], lambda row: row.update(fixtureOnly=True))),
        Case("candidate-only-file-disposition", add_file_dispositions([{"id":"file-disposition:candidate","kind":"policy.sourceFileDisposition.v1","sourceFileId":"file:one","status":"candidate","requiresIndividualSemanticApproval":False}])),
        Case("candidate-only-span-disposition", mutate_first(REQUIRED_FILES["span_dispositions"], lambda row: row.update(accepted=False, status="candidate"))),
        Case("contradictory-disposition", add_file_dispositions([
            {"id":"file-disposition:a","kind":"policy.sourceFileDisposition.v1","sourceFileId":"file:one","status":"accepted","requiresIndividualSemanticApproval":False},
            {"id":"file-disposition:b","kind":"policy.sourceFileDisposition.v1","sourceFileId":"file:one","status":"accepted","requiresIndividualSemanticApproval":True},
        ])),
        Case("missing-source-span-reference", mutate_first(REQUIRED_FILES["semantic_nodes"], lambda row: row["sourceSpanIds"].append("span:missing"))),
        Case("missing-edge-endpoint", mutate_first(REQUIRED_FILES["semantic_edges"], lambda row: row.update(to="node:missing"))),
        Case("generated-row-authority", mutate_first(REQUIRED_FILES["span_dispositions"], lambda row: row.update(generatedIsAuthority=True))),
        Case("missing-array-field", mutate_first(REQUIRED_FILES["semantic_nodes"], lambda row: row.pop("sourceSpanIds"))),
        Case("array-null", mutate_first(REQUIRED_FILES["semantic_nodes"], lambda row: row.update(sourceSpanIds=None))),
        Case("empty-array", mutate_first(REQUIRED_FILES["semantic_nodes"], lambda row: row.update(sourceSpanIds=[]))),
        Case("missing-nested-source-trace", mutate_first(REQUIRED_FILES["source_spans"], lambda row: row.pop("sourceTrace"))),
        Case("boolean-string", mutate_first(REQUIRED_FILES["coverage_proofs"], lambda row: row.update(accepted="true"))),
        Case("unknown-field", mutate_first(REQUIRED_FILES["source_spans"], lambda row: row.update(unexpected="value"))),
        Case("unknown-required-kind", mutate_first(REQUIRED_FILES["source_spans"], lambda row: row.update(kind="policy.unknown.v1"))),
        Case("engine-executable-unavailable", no_change, duckdb_bin="duckdb-does-not-exist", compare_mode="fail-closed"),
        Case("identical-input-twice", no_change, compare_mode="determinism"),
        Case("reordered-input-rows", compose(reverse_jsonl(REQUIRED_FILES["source_spans"]), reverse_jsonl(REQUIRED_FILES["semantic_edges"])), compare_mode="reorder"),
    ]

