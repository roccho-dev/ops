#!/usr/bin/env python3
import argparse
import contextlib
import importlib.util
import os
import tempfile
from pathlib import Path


ROOT = Path(os.environ.get("HQ_CDP_SCRIPT_SRC", Path(__file__).resolve().parent)).resolve()
PROJECT_TRANSPORT = ROOT / "project-transport.py"


def load_project_transport():
    spec = importlib.util.spec_from_file_location("project_transport", PROJECT_TRANSPORT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@contextlib.contextmanager
def patched(module, name, value):
    old = getattr(module, name)
    setattr(module, name, value)
    try:
        yield
    finally:
        setattr(module, name, old)


def ns(**values):
    base = {
        "addr": "127.0.0.1",
        "port": 9222,
        "timeout_ms": 180000,
        "dry_run": False,
        "out_path": None,
        "out_dir": None,
        "project_url": "https://chatgpt.com/g/g-p-test/project",
    }
    base.update(values)
    return argparse.Namespace(**base)


def test_upload_command_selection(pt):
    assert pt.project_source_upload_command(Path("request.md"), "auto") == "chromium-cdp-upload-project-source-text"
    assert pt.project_source_upload_command(Path("bundle.zip"), "auto") == "chromium-cdp-upload-project-source-file"
    assert pt.project_source_upload_command(Path("bundle.zip"), "text") == "chromium-cdp-upload-project-source-text"
    assert pt.project_source_upload_command(Path("request.md"), "file") == "chromium-cdp-upload-project-source-file"


def test_visible_upload_is_not_worker_readback(pt):
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        source = tmp_path / "handoff.txt"
        source.write_text("READBACK_MARK: sample\n")

        def fake_run(cmd, timeout=None):
            assert cmd[0] == "chromium-cdp-upload-project-source-text"
            return {
                "argv": cmd,
                "returncode": 0,
                "stdout": "",
                "stderr": "",
                "json": {
                    "ok": True,
                    "upload": {
                        "ok": True,
                        "textTail": f"Add sources\n{source.name}\nDocument",
                    },
                },
            }

        args = ns(file=str(source), out_dir=str(tmp_path), upload_mode="auto")
        with patched(pt, "run_command", fake_run):
            result = pt.source_put_result(args, pt.common_result("project-source-put", args))

        assert result["ok"] is True
        assert result["status"] == "source-upload-visible-unverified"
        assert result["transportVisible"] is True
        assert result["readbackVerified"] is False
        assert result["workerReadbackVerified"] is False
        assert result["verificationLevel"] == "visible-only"
        assert result["selectedUploadCommand"] == "chromium-cdp-upload-project-source-text"


def test_source_list_unreliable_is_not_success(pt):
    with tempfile.TemporaryDirectory() as tmp:
        def fake_run(cmd, timeout=None):
            return {
                "argv": cmd,
                "returncode": 0,
                "stdout": "",
                "stderr": "",
                "json": {
                    "ok": True,
                    "count": 0,
                    "sources": [],
                    "unparsedVisibleSourceCount": 1,
                    "unparsedVisibleSourceHints": [{"title": "request.md", "kindLine": "Document"}],
                },
            }

        args = ns(out_dir=tmp)
        with patched(pt, "run_command", fake_run):
            result = pt.source_list_result(args, pt.common_result("project-source-list", args))

        assert result["ok"] is False
        assert result["status"] == "source-list-unreliable"
        assert result["readbackVerified"] is False
        assert result["sourceListUnreliable"] is True
        assert result["sourceListAuthority"] == "advisory-project-source-inventory-probe"
        assert result["sourceAbsenceAuthoritative"] is False
        assert result["canOverrideWorkerReadback"] is False


def test_thread_readback_filters_to_assistant_hits(pt):
    captured = []

    def fake_write(args, result):
        captured.append(result)
        return 0 if result.get("ok") else 1

    def fake_run(cmd, timeout=None):
        return {
            "argv": cmd,
            "returncode": 0,
            "stdout": "",
            "stderr": "",
            "json": {
                "isStreaming": False,
                "hits": [
                    {"marker": "MARK", "role": "user", "preview": "prompt MARK"},
                    {"marker": "MARK", "role": "assistant", "preview": "MARK"},
                ],
            },
        }

    args = ns(
        url="https://chatgpt.com/g/g-p-test/c/thread",
        id="target",
        markers=["MARK"],
        marker_role="assistant",
        wait_ms=300000,
        tail=5,
    )
    with patched(pt, "run_command", fake_run), patched(pt, "maybe_write_out", fake_write):
        rc = pt.handle_thread_readback(args)

    assert rc == 0
    result = captured[-1]
    assert result["ok"] is True
    assert result["status"] == "readback-verified"
    assert result["matchedMarkers"] == ["MARK"]
    assert [hit["role"] for hit in result["matchedHits"]] == ["assistant"]


def test_thread_readback_rejects_user_only_and_streaming(pt):
    captured = []

    def fake_write(args, result):
        captured.append(result)
        return 0 if result.get("ok") else 1

    def user_only_run(cmd, timeout=None):
        return {
            "argv": cmd,
            "returncode": 0,
            "stdout": "",
            "stderr": "",
            "json": {"isStreaming": False, "hits": [{"marker": "MARK", "role": "user"}]},
        }

    args = ns(
        url="https://chatgpt.com/g/g-p-test/c/thread",
        id="target",
        markers=["MARK"],
        marker_role="assistant",
        wait_ms=300000,
        tail=5,
    )
    with patched(pt, "run_command", user_only_run), patched(pt, "maybe_write_out", fake_write):
        rc = pt.handle_thread_readback(args)
    assert rc == 1
    assert captured[-1]["status"] == "readback-missing-marker"
    assert captured[-1]["missingMarkers"] == ["MARK"]

    def streaming_run(cmd, timeout=None):
        return {
            "argv": cmd,
            "returncode": 0,
            "stdout": "",
            "stderr": "",
            "json": {"isStreaming": True, "hits": [{"marker": "MARK", "role": "assistant"}]},
        }

    with patched(pt, "run_command", streaming_run), patched(pt, "maybe_write_out", fake_write):
        rc = pt.handle_thread_readback(args)
    assert rc == 1
    assert captured[-1]["status"] == "readback-still-streaming"
    assert captured[-1]["readbackVerified"] is False


def test_browser_parser_regression_terms_are_present():
    listing_src = (ROOT / "chatgpt" / "project-source-listing.mjs").read_text()
    assert "line === 'Document'" in listing_src
    assert "line === 'Zip Archive'" in listing_src
    assert "unparsedVisibleSourceHints" in listing_src
    assert "unparsedVisibleSourceCount" in listing_src

    read_thread_src = (ROOT / "read-thread.mjs").read_text()
    assert "for (const m of msgs.filter((x) => x.text.includes(marker)))" in read_thread_src
    assert "streamWaitRounds" in read_thread_src


def test_same_run_worker_readback_beats_env_and_list_probe_false_negatives(pt):
    summary = pt.classify_transport_proof_steps([
        {"command": "project-source-put", "ok": True, "readbackVerified": False},
        {"command": "project-thread-create", "ok": True, "threadUrl": "https://chatgpt.com/g/g-p-test/c/abc"},
        {
            "command": "project-thread-readback",
            "ok": True,
            "readbackVerified": True,
            "markerRole": "assistant",
            "matchedMarkers": ["READBACK_MARK_20260526_LIVE_REPROOF_A"],
        },
        {"command": "project-transport-env", "ok": False, "status": "project-route-not-verified"},
        {"command": "project-source-list", "ok": True, "status": "source-list-empty", "sourceCount": 0},
    ])
    assert summary["workerReadableProof"] is True
    assert summary["workerReadableProofAuthority"] == "delayed-assistant-readback"
    assert summary["routeProbeCanOverrideWorkerReadback"] is False
    assert summary["sourceListCanOverrideWorkerReadback"] is False


def main():
    pt = load_project_transport()
    test_upload_command_selection(pt)
    test_visible_upload_is_not_worker_readback(pt)
    test_source_list_unreliable_is_not_success(pt)
    test_thread_readback_filters_to_assistant_hits(pt)
    test_thread_readback_rejects_user_only_and_streaming(pt)
    test_browser_parser_regression_terms_are_present()
    test_same_run_worker_readback_beats_env_and_list_probe_false_negatives(pt)
    print("PASS: project transport false-positive regression tests")


if __name__ == "__main__":
    main()
