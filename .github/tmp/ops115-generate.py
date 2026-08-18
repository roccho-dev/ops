from pathlib import Path
import json


def append_jsonl(path: str, row: dict, key: str = "name") -> None:
    p = Path(path)
    rows = [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
    if not any(x.get(key) == row[key] for x in rows):
        rows.append(row)
    p.write_text("".join(json.dumps(x, sort_keys=True, separators=(",", ":")) + "\n" for x in rows))


append_jsonl("build/packages.jsonl", {
    "bin": "ops-decision-closure",
    "deps": ["python3"],
    "entry": "packages/ops-decision-closure/bin/ops-decision-closure.py",
    "env": [],
    "kind": "package",
    "name": "ops-decision-closure",
    "runtime": "python",
})
append_jsonl("build/checks.jsonl", {
    "deps": ["python3", "ops-decision-closure"],
    "kind": "check",
    "name": "ops-decision-closure",
    "script": "packages/ops-decision-closure/tests/e2e.py",
})

core = Path("packages/ops-decision-closure/bin/ops-decision-closure.py")
text = core.read_text()
old = '''    if packet["packet_digest"] not in room: fail("PACKET_ROOM_DIGEST_MISMATCH", packet["decision_id"])
    for action in HUMAN_ACTIONS:
'''
new = '''    if packet["packet_digest"] not in room: fail("PACKET_ROOM_DIGEST_MISMATCH", packet["decision_id"])
    if f'data-decision-id="{html.escape(packet["decision_id"])}"' not in room: fail("PACKET_ROOM_DECISION_MISMATCH", packet["decision_id"])
    if f'data-checkpoint-id="{html.escape(packet["checkpoint_id"])}"' not in room: fail("PACKET_ROOM_CHECKPOINT_MISMATCH", packet["checkpoint_id"])
    for action in HUMAN_ACTIONS:
'''
assert old in text
core.write_text(text.replace(old, new, 1))

proof = Path("packages/ops-decision-closure/tests/proof.py")
text = proof.read_text()
old = '''    case("unresolved-contradiction", claims, lambda x: [x[0]["rel"].append(rel("contradicts", x[2]["id"])), x[2]["rel"].append(rel("contradicts", x[0]["id"]))], "UNRESOLVED_CONTRADICTION")
'''
new = '''    case("unresolved-contradiction", claims, lambda x: [x[1]["rel"].append(rel("contradicts", x[3]["id"])), x[3]["rel"].append(rel("contradicts", x[1]["id"]))], "UNRESOLVED_CONTRADICTION")
'''
assert old in text
text = text.replace(old, new, 1)
proof.write_text(text)
