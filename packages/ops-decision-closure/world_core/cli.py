"""CLI for reversible world-core compatibility and proof verification."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from .model import MAPPER_ID, STREAMS, WorldError, dumps, write_jsonl
from .project import project_fcc, reconstruct_fcc
from .sqlite_projection import create_sqlite
from .verify import verify_proof, verify_world


def command_from_fcc(args: argparse.Namespace) -> int:
    inputs = {name: Path(getattr(args, name)) for name in STREAMS}
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    items, claims, mappings, relations, identities, units, scales = project_fcc(inputs)
    write_jsonl(out_dir / "items.jsonl", items)
    write_jsonl(out_dir / "claims.jsonl", claims)
    write_jsonl(out_dir / "mappings.jsonl", mappings)
    write_jsonl(out_dir / "relations.jsonl", relations)
    write_jsonl(out_dir / "identities.jsonl", identities)
    write_jsonl(out_dir / "units.jsonl", units)
    write_jsonl(out_dir / "scales.jsonl", scales)
    summary = verify_world(
        out_dir / "items.jsonl",
        out_dir / "claims.jsonl",
        out_dir / "mappings.jsonl",
        out_dir / "relations.jsonl",
    )
    create_sqlite(out_dir / "world.sqlite3", items, claims, mappings, relations, units, scales)
    summary.update(
        {
            "schema": "world.compatibility.receipt/1",
            "mapper": MAPPER_ID,
            "identities": len(identities),
            "units": len(units),
            "scales": len(scales),
            "sqlite": "world.sqlite3",
        }
    )
    (out_dir / "receipt.json").write_text(
        json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(dumps(summary))
    return 0


def command_to_fcc(args: argparse.Namespace) -> int:
    counts = reconstruct_fcc(Path(args.items), Path(args.claims), Path(args.out_dir))
    print(dumps({"status": "PASS", "schema": "world.compatibility.reverse/1", "counts": counts}))
    return 0


def command_verify(args: argparse.Namespace) -> int:
    result = verify_world(
        Path(args.items), Path(args.claims), Path(args.mappings), Path(args.relations)
    )
    print(dumps(result))
    return 0


def command_verify_proof(args: argparse.Namespace) -> int:
    print(dumps(verify_proof(Path(args.proof_dir))))
    return 0


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        description="Project Fact / Condition / Claim into a reversible item + claim world layer."
    )
    sub = command.add_subparsers(dest="command", required=True)

    fcc = sub.add_parser("from-fcc", help="project Fact / Condition / Claim JSONL")
    fcc.add_argument("--facts", required=True)
    fcc.add_argument("--conditions", required=True)
    fcc.add_argument("--claims", required=True)
    fcc.add_argument("--out-dir", required=True)
    fcc.set_defaults(run=command_from_fcc)

    reverse = sub.add_parser("to-fcc", help="reconstruct Fact / Condition / Claim JSONL")
    reverse.add_argument("--items", required=True)
    reverse.add_argument("--claims", required=True)
    reverse.add_argument("--out-dir", required=True)
    reverse.set_defaults(run=command_to_fcc)

    verify = sub.add_parser("verify", help="verify world-core integrity")
    verify.add_argument("--items", required=True)
    verify.add_argument("--claims", required=True)
    verify.add_argument("--mappings", required=True)
    verify.add_argument("--relations", required=True)
    verify.set_defaults(run=command_verify)

    proof = sub.add_parser("verify-proof", help="verify a bounded world proof directory")
    proof.add_argument("--proof-dir", required=True)
    proof.set_defaults(run=command_verify_proof)
    return command


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return int(args.run(args))
    except WorldError as exc:
        print(dumps({"status": "ERROR", "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
