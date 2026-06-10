from __future__ import annotations

from pathlib import Path
import tempfile

from ops_issue_ledger.core import audit_workspace, check_ledgers, ledger_report

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"


def test_valid_fixture_passes():
    result = ledger_report(FIXTURES / "current.jsonl")
    assert result["ok"], result["diagnostics"]
    assert result["records"] == 1


def test_non_v1_under_issues_fails():
    result = ledger_report(FIXTURES / "non-v1-under-issues.jsonl")
    assert not result["ok"]
    assert any(item["code"] == "non-v1-issue-record" for item in result["diagnostics"])


def test_workspace_discovery_excludes_example_poc_example():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        repo = root / "repo-main"
        (repo / "issues").mkdir(parents=True)
        (repo / "README.md").write_text("repo fixture\n", encoding="utf-8")
        (repo / "issues" / "260603.jsonl").write_text((FIXTURES / "current.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
        example = repo / "example" / "poc" / "example"
        example.mkdir(parents=True)
        (example / "non-v1.jsonl").write_text((FIXTURES / "poc-example-non-v1.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
        result = audit_workspace(root, require_ledger=True)
        assert result["ok"], result
        assert result["examplePocExampleIsAuthority"] is False
        assert result["recordCount"] == 1


def test_check_ledgers_reports_semantics_profile():
    result = check_ledgers([FIXTURES / "current.jsonl"])
    assert result["ok"]
    assert result["semanticsProfile"] == "canonical-latest-state-v1"
    assert result["classification"] == "issue-ledger-unified-kernel-pass"


def run_all():
    for test in [
        test_valid_fixture_passes,
        test_non_v1_under_issues_fails,
        test_workspace_discovery_excludes_example_poc_example,
        test_check_ledgers_reports_semantics_profile,
    ]:
        test()
    print("ops-issue-ledger-tests-pass")


if __name__ == "__main__":
    run_all()
