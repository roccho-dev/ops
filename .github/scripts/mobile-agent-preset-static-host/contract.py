#!/usr/bin/env python3
import hashlib
import json
import pathlib

root = pathlib.Path('verification/mobile-agent-preset-app')
app = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
expected = json.loads((root / 'expected.json').read_text(encoding='utf-8'))
assert app['schema'] == 'ops.mobileAgentPresetApp/1' and app['authority'] is False
assert app['architectureIssue'] == 233 and app['operationsIssue'] == 242
assert app['source']['externalSourceCommit'] == '1daa001bf780053f4319e3fb20b4ea9a6e0d0442'
assert app['source']['externalSourceTree'] == '59ff130fc7e20a4b5762c21fe97b417fc7a454ad'
assert app['source']['fullBundleSha256'] == 'sha256:208a70f3038896c9f0bd70b31d33244e913489caa7356e7968262ef0dc58bde6'
assert app['source']['sourceAuthorityCandidate']['implementationRewritten'] is False
assert app['presetContract']['presets'] == [
    {'id': 'graph/1', 'surface': 'maxgraph', 'editable': True},
    {'id': 'map/1', 'surface': 'maxgraph', 'editable': True},
    {'id': 'seq/1', 'surface': 'maxgraph', 'editable': True},
]
assert app['provider']['project'] == 'stg-mobile-agent' and app['provider']['rootOwned'] is True
assert expected['schema'] == 'semantic-map-build-artifact/1' and len(expected['files']) == 54
rows = [
    {'path': path, 'bytes': spec['bytes'], 'sha256': spec['sha256']}
    for path, spec in sorted(expected['files'].items())
]
canonical = json.dumps(rows, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
assert 'sha256:' + hashlib.sha256(canonical).hexdigest() == app['publication']['distTreeDigest']
for fixture in app['fixtures']:
    assert 'sha256:' + hashlib.sha256((root / fixture['path']).read_bytes()).hexdigest() == fixture['sha256']
values = {
    'archive_name': app['publication']['archive']['name'],
    'archive_bytes': app['publication']['archive']['bytes'],
    'archive_sha': app['publication']['archive']['sha256'][7:],
    'carrier_name': app['publication']['carrier']['name'],
    'carrier_bytes': app['publication']['carrier']['bytes'],
    'carrier_sha': app['publication']['carrier']['sha256'][7:],
    'project': app['provider']['project'],
    'tag': app['publication']['tag'],
    'bootstrap_base': app['bootstrap']['baseUrl'],
}
for key, value in values.items():
    print(f'{key}={value}')
