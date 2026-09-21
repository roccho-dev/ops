#!/usr/bin/env python3
import importlib.util
import io
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify", root / "verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)

good = {
    "schema": "ops.deploy-effect.receipt/1",
    "authority": False,
    "status": "PASS",
    "provider": "example",
    "target": "preview",
    "sourceRevision": "deadbeef",
    "providerDeploymentId": "dep_1",
    "deploymentUrl": "https://example.invalid",
    "probe": {"path": "/health", "status": 200},
}

verify.verify(dict(good))

bad = []
x = dict(good); x["authority"] = True; bad.append(x)
x = dict(good); x["deploymentUrl"] = "http://example.invalid"; bad.append(x)
x = dict(good); x["probe"] = {"path": "/health", "status": 503}; bad.append(x)
x = dict(good); x["target"] = "unknown"; bad.append(x)
x = dict(good); x["sourceRevision"] = ""; bad.append(x)

for case in bad:
    try:
        verify.verify(case)
    except SystemExit:
        pass
    else:
        raise SystemExit("invalid receipt was accepted")

try:
    verify.load_one(io.StringIO("{}\n{}\n"))
except SystemExit:
    pass
else:
    raise SystemExit("multiple receipt lines were accepted")

print("deploy-adapter contract PASS")
