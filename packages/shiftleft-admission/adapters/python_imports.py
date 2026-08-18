#!/usr/bin/env python3
import ast
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
root = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
rows = []
for node in ast.walk(root):
    if isinstance(node, ast.Import):
        for alias in node.names:
            rows.append({"module": alias.name, "line": node.lineno})
    elif isinstance(node, ast.ImportFrom):
        rows.append({"module": node.module or "", "line": node.lineno})
rows.sort(key=lambda x: (x["module"], x["line"]))
print(json.dumps({"schema": "shiftleft-import-report/1", "imports": rows}, separators=(",", ":")))
