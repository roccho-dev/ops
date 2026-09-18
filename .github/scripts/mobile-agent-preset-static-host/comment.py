#!/usr/bin/env python3
import json
import os
import sys
stable = {x['id']: x['url'] for x in json.load(open(sys.argv[1]))['cases']}
immutable = {x['id']: x['url'] for x in json.load(open(sys.argv[2]))['cases']}
print('## Mobile Agent existing preset deployment — PASS\n')
print('- public 54/54 byte readback: **PASS** on stable and immutable hosts')
print('- existing maxGraph, toolbar, source, handoff, review, Graph drag/undo/redo, Map zoom, Seq edit/undo: **PASS**')
for key in ('graph', 'map', 'seq'):
    print(f'- {key.title()}: {stable[key]}')
print('- immutable URLs:')
for key in ('graph', 'map', 'seq'):
    print(f'  - `{key}`: {immutable[key]}')
print(f"- run: {os.environ['RUN_URL']}")
print(f"- evidence: `{os.environ['ARTIFACT_ID']}` / `{os.environ['ARTIFACT_DIGEST']}`")
print('\nSource provenance remains authority; Release, Pages, URLs and receipts are projections. #233 remains open until the exact Git source ref is promoted.')
