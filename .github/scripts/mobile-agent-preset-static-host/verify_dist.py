#!/usr/bin/env python3
import hashlib
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
expected = json.load(open(sys.argv[2], encoding='utf-8'))
actual = sorted(path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file())
assert actual == sorted(expected['files'])
for rel, spec in expected['files'].items():
    data = (root / rel).read_bytes()
    assert len(data) == spec['bytes']
    assert hashlib.sha256(data).hexdigest() == spec['sha256']
