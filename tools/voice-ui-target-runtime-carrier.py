#!/usr/bin/env python3
"""Runtime carrier for voice-ui-target-runtime (roccho-dev/ops#435/#436).

cache.nixos.org does not serve wrangler-4.62.0 for this repository's nixpkgs
pin, and building it needs registry.npmjs.org. A closed-network consumer can
therefore not provision the runtime from the official cache alone.

This release helper computes the Nix paths that the runtime and its boundary
check need but the official signed cache cannot supply, requires that set to
be exactly {wrangler-4.62.0}, prunes a native file:// binary cache down to
that one path, packs it deterministically and verifies the published set.
It is never part of the runtime output or closure.

plan          classify the build graph and compute the missing set
pack          prune a native file:// cache to the carried path and archive it
check-pack    verify an archive against a plan (pull-request runs)
provenance    write provenance for a packed archive
verify        verify a complete release directory (pre-Nix, no network)
dry-run-check verify a Phase B `nix build --dry-run` log
selftest      fail-closed cases for everything above
"""
import argparse, base64, hashlib, io, json, os, pathlib, re, subprocess, tarfile

OFFICIAL_CACHE = 'https://cache.nixos.org'
OFFICIAL_KEY = 'cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY='
NIX = ['nix', '--extra-experimental-features', 'nix-command flakes']
CARRIED = 'wrangler-4.62.0'
# Exactly these derivations are built by the consumer: three apps release
# fetches, four ops roots and the nodejs wrapper nixpkgs marks local-only.
FETCHES = {'voice-ui-dist.zip', 'merged-pr-proof.json', 'provenance.json'}
ROOTS = {'check-voice-ui-release.py', 'voice-ui-dist-release', 'voice-ui-target-runtime', 'voice-ui-target-runtime-boundary'}
NODE = {'name': 'nodejs-24.14.1', 'drv': '8l6p07vmrcj7lsry0jz2ayp1rmpyjdai-nodejs-24.14.1.drv',
        'out': '785jidgnryzj566s25s3rb262d4g5znb-nodejs-24.14.1'}
LOCAL = FETCHES | ROOTS | {NODE['name']}
REQUIRED_BUILT = LOCAL - {NODE['name']}
TOP = {'voice-ui-target-runtime', 'voice-ui-target-runtime-boundary'}
FORBIDDEN_IN_DRY_RUN = {CARRIED, 'wrangler-pnpm-deps'}
ARCHIVE = 'voice-ui-target-runtime-carrier.tar'
ASSETS = {ARCHIVE, ARCHIVE + '.sha256', 'provenance.json', 'merged-pr-proof.json'}
LIMIT = 2147483648
SCHEMA = 'roccho.voice-ui-target-runtime.carrier-provenance/1'
WORKFLOW = '.github/workflows/voice-ui-target-runtime-carrier.yml'
STORE = '/nix/store/'
NIX32 = '0123456789abcdfghijklmnpqrsvwxyz'


class Stop(SystemExit):
    pass


def need(ok, message):
    if not ok:
        raise Stop(message)


def nix32(digest):
    """Nix's base-32 encoding of a raw digest."""
    out = []
    for n in range((len(digest) * 8 - 1) // 5, -1, -1):
        b = n * 5
        i, j = b // 8, b % 8
        c = digest[i] >> j
        if i + 1 < len(digest):
            c |= digest[i + 1] << (8 - j)
        out.append(NIX32[c & 0x1f])
    return ''.join(out)


def sri_to_narinfo(sri):
    need(sri.startswith('sha256-'), f'not a sha256 SRI hash: {sri}')
    return 'sha256:' + nix32(base64.b64decode(sri[7:]))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def base(path):
    return path[len(STORE):] if path.startswith(STORE) else path


def name_of(path):
    b = base(path)
    b = b[:-4] if b.endswith('.drv') else b
    return b.split('-', 1)[1]


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if p.returncode:
        raise Stop(f'command failed ({p.returncode}): {" ".join(cmd)}\n{p.stderr[-2000:]}')
    return p.stdout


def signed_on_official_cache(paths):
    """Paths the official cache serves with a valid official signature."""
    good = set()
    for p in sorted(paths):
        q = subprocess.run(NIX + ['store', 'verify', '--store', OFFICIAL_CACHE, '--no-contents', '--sigs-needed', '1',
                                  '--option', 'trusted-public-keys', OFFICIAL_KEY, STORE + base(p)],
                           capture_output=True, text=True)
        if q.returncode == 0:
            good.add(base(p))
    return good


# ---------- plan ----------

def classify(derivations):
    """Exact-name local set and the external outputs the local set consumes."""
    by_name = {}
    for drv, d in derivations.items():
        if d.get('name') in LOCAL:
            by_name.setdefault(d['name'], []).append(drv)
    for n in sorted(LOCAL):
        need(len(by_name.get(n, [])) == 1, f'expected exactly one derivation named {n}, found {by_name.get(n, [])}')
    local = {n: v[0] for n, v in by_name.items()}
    need(local[NODE['name']] == NODE['drv'], f'nodejs wrapper drifted: {local[NODE["name"]]}')
    need(derivations[NODE['drv']]['outputs']['out'].get('path') == NODE['out'], 'nodejs wrapper output drifted')
    local_drvs = set(local.values())
    reached, stack, external = set(), [local[n] for n in sorted(TOP)], set()
    while stack:
        drv = stack.pop()
        if drv in reached:
            continue
        reached.add(drv)
        for inp, spec in (derivations[drv]['inputs'].get('drvs') or {}).items():
            if inp in local_drvs:
                stack.append(inp)
                continue
            need(derivations[inp].get('name') not in LOCAL, f'second derivation named {derivations[inp].get("name")}: {inp}')
            # Nix builds a derivation locally instead of substituting it only
            # when allowSubstitutes is false; preferLocalBuild alone still
            # substitutes (for example nixpkgs' mirrors-list).
            env = derivations[inp].get('env') or {}
            need(env.get('allowSubstitutes', '1') not in ('', '0', 'false'),
                 f'unexpected local-only derivation outside the exact eight: {inp}')
            for out in spec['outputs']:
                path = derivations[inp]['outputs'][out].get('path')
                need(path, f'external output has no store path (fixed-output outside the exact eight?): {inp}!{out}')
                external.add(path)
    need(reached == local_drvs, f'local derivations not all reached from the roots: {sorted(local_drvs - reached)}')
    return local, external


def missing_set(external, signed):
    return sorted(p for p in external if p not in signed)


def check_missing(missing, wrangler_out):
    need([name_of(p) for p in missing] == [CARRIED], f'missing set must be exactly {{{CARRIED}}}, found {missing}')
    need(missing[0] == base(wrangler_out), f'carried path {missing[0]} differs from the lock-pinned {wrangler_out}')
    return missing[0]


def plan(a):
    installables = [a.flake + '#voice-ui-target-runtime', a.flake + '#checks.x86_64-linux.voice-ui-target-runtime']
    derivations = json.loads(run(NIX + ['derivation', 'show', '-r', *installables]))['derivations']
    local, external = classify(derivations)
    wrangler_out = run(NIX + ['eval', '--raw', '--inputs-from', a.flake, 'nixpkgs#wrangler.outPath']).strip()
    carried = check_missing(missing_set(external, signed_on_official_cache(external)), wrangler_out)
    info = json.loads(run(NIX + ['path-info', '--json', STORE + carried]))
    info = info[STORE + carried] if STORE + carried in info else next(iter(info.values()))
    refs = sorted(base(r) for r in info['references'] if base(r) != carried)
    signed_refs = signed_on_official_cache(refs)
    need(set(refs) == signed_refs, f'carried references not all signed on the official cache: {sorted(set(refs) - signed_refs)}')
    ext = json.loads(run(NIX + ['path-info', '--json', '--store', OFFICIAL_CACHE, *[STORE + r for r in refs]]))
    ext = {base(k): v for k, v in ext.items()}
    out = {
        'kind': 'voice-ui-target-runtime.carrier-plan/1',
        'nix_version': run(NIX + ['--version']).strip(),
        'local': dict(sorted(local.items())),
        'external_count': len(external),
        'carried': {'path': carried, 'narHash': info['narHash'], 'narSize': info['narSize'],
                    'references': sorted(base(r) for r in info['references'])},
        'external_references': [{'path': r, 'narHash': ext[r]['narHash'], 'narSize': ext[r]['narSize'],
                                 'signatures': sorted(ext[r].get('signatures') or [])} for r in refs],
    }
    for r in out['external_references']:
        need(any(s.startswith('cache.nixos.org-1:') for s in r['signatures']), f'no official signature recorded for {r["path"]}')
    pathlib.Path(a.out).write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    print(f'plan: carried {carried}; {len(refs)} signed external references; {len(external)} external inputs')


# ---------- archive ----------

def parse_narinfo(text):
    fields = {}
    for line in text.splitlines():
        key, sep, value = line.partition(': ')
        need(sep and key not in fields, f'malformed or duplicate narinfo line: {line!r}')
        fields[key] = value
    return fields


def check_narinfo(fields, carried, nar_bytes):
    need('Sig' not in fields, 'carried narinfo must be unsigned; a Sig line is present')
    need(fields.get('StorePath') == STORE + carried['path'], f'narinfo StorePath {fields.get("StorePath")}')
    need(fields.get('Compression') == 'zstd', f'narinfo compression {fields.get("Compression")}')
    need(fields.get('NarHash') == sri_to_narinfo(carried['narHash']), 'narinfo NarHash differs from the carried path')
    need(fields.get('NarSize') == str(carried['narSize']), 'narinfo NarSize differs from the carried path')
    need(sorted(fields.get('References', '').split()) == sorted(carried['references']), 'narinfo References differ')
    need(re.fullmatch(r'nar/[0-9a-z]+\.nar\.zst', fields.get('URL', '')), f'unexpected narinfo URL {fields.get("URL")}')
    need(fields.get('FileSize') == str(len(nar_bytes)), 'narinfo FileSize differs from the NAR file')
    need(fields.get('FileHash') == 'sha256:' + nix32(hashlib.sha256(nar_bytes).digest()), 'narinfo FileHash differs from the NAR file')


def expected_members(carried, url):
    return sorted(['nix-cache-info', carried['path'].split('-', 1)[0] + '.narinfo', url])


def inspect_members(members, carried):
    """members: {name: bytes}. The exact pruned cache, verified without Nix."""
    need('nix-cache-info' in members, 'nix-cache-info missing')
    need(members['nix-cache-info'].decode().splitlines()[0] == 'StoreDir: /nix/store', 'nix-cache-info StoreDir differs')
    narinfo_name = carried['path'].split('-', 1)[0] + '.narinfo'
    need(narinfo_name in members, f'{narinfo_name} missing')
    fields = parse_narinfo(members[narinfo_name].decode())
    need(sorted(members) == expected_members(carried, fields.get('URL', '')),
         f'cache members must be exactly {expected_members(carried, fields.get("URL", ""))}, found {sorted(members)}')
    check_narinfo(fields, carried, members[fields['URL']])
    return fields


def read_archive(path):
    members = {}
    with tarfile.open(path, 'r:') as t:
        for m in t.getmembers():
            need(m.isfile() and not m.name.startswith('/') and '..' not in m.name.split('/'), f'unsafe archive member {m.name}')
            need(m.name not in members, f'duplicate archive member {m.name}')
            members[m.name] = t.extractfile(m).read()
    return members


def write_archive(path, members):
    with tarfile.open(path, 'w', format=tarfile.USTAR_FORMAT) as t:
        for name in sorted(members):
            info = tarfile.TarInfo(name)
            info.size, info.mtime, info.mode, info.uid, info.gid, info.uname, info.gname = len(members[name]), 0, 0o444, 0, 0, '', ''
            t.addfile(info, io.BytesIO(members[name]))


def pack(a):
    carried = json.loads(pathlib.Path(a.plan).read_text())['carried']
    cache = pathlib.Path(a.cache)
    narinfo = cache / (carried['path'].split('-', 1)[0] + '.narinfo')
    fields = parse_narinfo(narinfo.read_text())
    members = {'nix-cache-info': (cache / 'nix-cache-info').read_bytes(), narinfo.name: narinfo.read_bytes(),
               fields['URL']: (cache / fields['URL']).read_bytes()}
    inspect_members(members, carried)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=False)
    write_archive(out / ARCHIVE, members)
    size = (out / ARCHIVE).stat().st_size
    need(size < LIMIT, f'archive is {size} bytes, not below {LIMIT}: STOP')
    digest = sha256((out / ARCHIVE).read_bytes())
    (out / (ARCHIVE + '.sha256')).write_text(f'{digest}  {ARCHIVE}\n')
    print(f'pack: {ARCHIVE} {size} bytes sha256 {digest}; members {sorted(members)}')


def check_archive(directory, carried):
    d = pathlib.Path(directory)
    data = (d / ARCHIVE).read_bytes()
    need(len(data) < LIMIT, f'archive is {len(data)} bytes, not below {LIMIT}')
    need((d / (ARCHIVE + '.sha256')).read_text().split() == [sha256(data), ARCHIVE], 'archive sha256 file does not match')
    return inspect_members(read_archive(d / ARCHIVE), carried), data


def check_pack(a):
    carried = json.loads(pathlib.Path(a.plan).read_text())['carried']
    check_archive(a.dir, carried)
    print(f'check-pack {a.dir}: PASS')


# ---------- provenance / verify ----------

def locator(repository, sha, name=ARCHIVE):
    return f'https://github.com/{repository}/releases/download/voice-ui-target-runtime-carrier-{sha}/{name}'


def provenance(a):
    p = json.loads(pathlib.Path(a.plan).read_text())
    fields, data = check_archive(a.dir, p['carried'])
    root = pathlib.Path(a.root)
    value = {
        'schema': SCHEMA,
        'producer': {'repository': a.repository, 'workflow_ref': a.workflow_ref, 'run_id': a.run_id, 'run_attempt': a.run_attempt},
        'source': {'repository': a.repository, 'commit': a.sha, 'tree': a.tree},
        'input_digests': {'flake.lock': sha256((root / 'flake.lock').read_bytes())},
        'nix_version': p['nix_version'],
        'official_cache': {'url': OFFICIAL_CACHE, 'public_key': OFFICIAL_KEY},
        'local': p['local'],
        'carried': {**p['carried'], 'narinfo': {k: fields[k] for k in ('URL', 'Compression', 'FileHash', 'FileSize')}},
        'external_references': p['external_references'],
        'archive': {'name': ARCHIVE, 'bytes': len(data), 'sha256': sha256(data)},
        'locator': locator(a.repository, a.sha),
        'cross_host_bytes_reproducible': False,
    }
    pathlib.Path(a.out).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def check_release(names, provenance_value, proof, archive_sha, archive_bytes, sha, repository):
    need(names == ASSETS, f'release set must be exactly {sorted(ASSETS)}, found {sorted(names)}')
    p, q = provenance_value, proof
    checks = {
        'schema': p.get('schema') == SCHEMA,
        'source commit': p['source']['commit'] == sha and p['source']['repository'] == repository,
        'producer': p['producer']['repository'] == repository
                    and p['producer']['workflow_ref'] == f'{repository}/{WORKFLOW}@refs/heads/proposals',
        'not cross-host reproducible': p.get('cross_host_bytes_reproducible') is False,
        'locator': p.get('locator') == locator(repository, sha),
        'archive': p.get('archive') == {'name': ARCHIVE, 'bytes': archive_bytes, 'sha256': archive_sha},
        'official cache': p.get('official_cache') == {'url': OFFICIAL_CACHE, 'public_key': OFFICIAL_KEY},
        'carried name': name_of(p['carried']['path']) == CARRIED,
        'local set': sorted(p.get('local', {})) == sorted(LOCAL) and p['local'][NODE['name']] == NODE['drv'],
        'external references signed': bool(p.get('external_references')) and all(
            any(s.startswith('cache.nixos.org-1:') for s in r['signatures']) for r in p['external_references']),
        'proof merge': q.get('merge_sha') == sha and q.get('base') == 'proposals',
        'proof trees': q.get('reviewed_tree') == q.get('merge_tree') == p['source']['tree'],
        'proof complete': all(q.get(k) for k in ('pr_number', 'r_exact_head_verdict_ref', 'merged_at', 'reviewed_head')),
    }
    failed = [k for k, ok in checks.items() if not ok]
    need(not failed, 'release record mismatch: ' + ', '.join(failed))


def verify(a):
    d = pathlib.Path(a.dir)
    p = json.loads((d / 'provenance.json').read_text())
    q = json.loads((d / 'merged-pr-proof.json').read_text())
    fields, data = check_archive(d, p['carried'])
    need({k: fields[k] for k in ('URL', 'Compression', 'FileHash', 'FileSize')} == p['carried']['narinfo'], 'provenance narinfo differs')
    check_release({x.name for x in d.iterdir()}, p, q, sha256(data), len(data), a.sha, a.repository)
    print(f'release set {a.sha}: PASS')


# ---------- Phase B dry run ----------

def parse_dry_run(text):
    built, fetched, section = [], [], None
    for line in text.splitlines():
        if re.match(r'^(this derivation|these \d+ derivations) will be built:', line):
            section = built
        elif re.match(r'^(this path|these \d+ paths) will be fetched', line):
            section = fetched
        elif line.startswith('  /nix/store/') and section is not None:
            section.append(base(line.strip()))
        else:
            section = None
    return built, fetched


def check_dry_run(built, fetched, signed):
    names = sorted(name_of(p) for p in built)
    need(len(set(names)) == len(names), f'duplicate derivation names will be built: {names}')
    need(REQUIRED_BUILT <= set(names) <= REQUIRED_BUILT | {NODE['name']},
         f'will be built must be exactly {sorted(REQUIRED_BUILT)} (optionally {NODE["name"]}), found {names}')
    if NODE['name'] in names:
        need(NODE['drv'] in built, 'a different nodejs wrapper would be built')
    for p in built + fetched:
        need(name_of(p) not in FORBIDDEN_IN_DRY_RUN, f'{name_of(p)} must not appear after Phase A: {p}')
    unsigned = sorted(set(fetched) - signed)
    need(not unsigned, f'will be fetched contains paths not signed on the official cache: {unsigned}')


def dry_run_check(a):
    built, fetched = parse_dry_run(pathlib.Path(a.log).read_text())
    check_dry_run(built, fetched, signed_on_official_cache(fetched))
    print(f'dry run: {len(built)} built {sorted(name_of(p) for p in built)}, {len(fetched)} fetched, all official-signed: PASS')


# ---------- selftest ----------

def selftest(a):
    assert nix32(hashlib.sha256(b'').digest()) == '0mdqa9w1p6cmli6976v4wi0sw9r4p5prkj7lzfd1877wk11c9c73'
    assert sri_to_narinfo('sha256-Q1KGHrhe6iUOaiJ1+EWd8Qp7V4bctkrscUaIWseCtRg=') == 'sha256:065mhb3mm226f7n4mdnwhrbpn2pikm2zhx92d872bsjyp0g8clj3'
    negatives = 0

    def rejects(fn, *args):
        nonlocal negatives
        try:
            fn(*args)
        except Stop:
            negatives += 1
            return
        raise AssertionError(f'{fn.__name__} accepted {args!r}')

    w = '4wg6l17z27a2hpw6wz21pxy7cm43zj8l-' + CARRIED
    # graph classification
    def drv(name, inputs=(), out=None, env=None):
        return {'name': name, 'env': env or {}, 'outputs': {'out': {'path': out or ('x' * 32 + '-' + name)}},
                'inputs': {'drvs': {i: {'outputs': ['out']} for i in inputs}, 'srcs': []}}
    def graph():
        g = {f'{n}.drv': drv(n) for n in FETCHES | {'check-voice-ui-release.py'}}
        g['wrangler.drv'] = drv(CARRIED, out=w)
        g['python.drv'] = drv('python3')
        g[NODE['drv']] = drv(NODE['name'], out=NODE['out'], env={'allowSubstitutes': '', 'preferLocalBuild': '1'})
        g['dist.drv'] = drv('voice-ui-dist-release', ['voice-ui-dist.zip.drv', 'python.drv'])
        g['rt.drv'] = drv('voice-ui-target-runtime', [NODE['drv'], 'wrangler.drv', 'dist.drv'])
        g['bc.drv'] = drv('voice-ui-target-runtime-boundary', ['rt.drv', 'wrangler.drv', 'merged-pr-proof.json.drv',
                                                               'provenance.json.drv', 'check-voice-ui-release.py.drv'])
        return g
    local, external = classify(graph())
    assert sorted(local) == sorted(LOCAL) and w in external and NODE['out'] not in external
    assert check_missing(missing_set(external, external - {w}), STORE + w) == w
    g = graph(); g['extra.drv'] = drv('nodejs-24.14.1', out='y' * 32 + '-nodejs-24.14.1'); rejects(classify, g)
    g = graph(); g['make.drv'] = drv('hook', env={'allowSubstitutes': '', 'preferLocalBuild': '1'}); g['rt.drv']['inputs']['drvs']['make.drv'] = {'outputs': ['out']}
    rejects(classify, g)
    g = graph(); g['mirrors.drv'] = drv('mirrors-list', env={'preferLocalBuild': '1'}); g['dist.drv']['inputs']['drvs']['mirrors.drv'] = {'outputs': ['out']}
    assert 'x' * 32 + '-mirrors-list' in classify(g)[1]
    g = graph(); g[NODE['drv']]['outputs']['out']['path'] = 'z' * 32 + '-nodejs-24.14.1'; rejects(classify, g)
    g = graph(); del g['provenance.json.drv']; g['bc.drv']['inputs']['drvs'].pop('provenance.json.drv'); rejects(classify, g)
    rejects(check_missing, missing_set(external, external - {w, 'x' * 32 + '-python3'}), STORE + w)
    rejects(check_missing, [], STORE + w)
    rejects(check_missing, [w], STORE + 'q' * 32 + '-' + CARRIED)
    # pruned cache members
    nar = b'compressed nar bytes'
    carried = {'path': w, 'narHash': 'sha256-Q1KGHrhe6iUOaiJ1+EWd8Qp7V4bctkrscUaIWseCtRg=', 'narSize': 1869923816,
               'references': sorted([w, NODE['out']])}
    url = 'nar/' + nix32(hashlib.sha256(nar).digest()) + '.nar.zst'
    narinfo = '\n'.join([f'StorePath: {STORE}{w}', f'URL: {url}', 'Compression: zstd',
                         'FileHash: sha256:' + nix32(hashlib.sha256(nar).digest()), f'FileSize: {len(nar)}',
                         'NarHash: sha256:065mhb3mm226f7n4mdnwhrbpn2pikm2zhx92d872bsjyp0g8clj3', 'NarSize: 1869923816',
                         f'References: {NODE["out"]} {w}', 'Deriver: 7d1k5vc23dvasbkr7z51n5lwi1260035-wrangler-4.62.0.drv']) + '\n'
    good = {'nix-cache-info': b'StoreDir: /nix/store\nWantMassQuery: 1\nPriority: 30\n', w.split('-', 1)[0] + '.narinfo': narinfo.encode(), url: nar}
    inspect_members(good, carried)
    for mutate in (
        lambda m: m.__setitem__(url, nar[:-1] + b'X'),                                  # flipped NAR byte
        lambda m: m.__setitem__('0' * 32 + '.narinfo', narinfo.encode()),               # extra narinfo
        lambda m: m.__setitem__(url + '.ls', b'{}'),                                     # listing survives
        lambda m: m.__setitem__('log/x.drv', b''),                                       # build log survives
        lambda m: m.pop('nix-cache-info'),                                               # missing cache info
        lambda m: m.__setitem__(w.split('-', 1)[0] + '.narinfo', (narinfo + 'Sig: k:x\n').encode()),   # signed
        lambda m: m.__setitem__(w.split('-', 1)[0] + '.narinfo', narinfo.replace('NarSize: 1869923816', 'NarSize: 1').encode()),
        lambda m: m.__setitem__(w.split('-', 1)[0] + '.narinfo', narinfo.replace(f'References: {NODE["out"]} ', 'References: ').encode()),
    ):
        m = dict(good); mutate(m); rejects(inspect_members, m, carried)
    # deterministic archive round trip
    buf = pathlib.Path(os.environ.get('TMPDIR', '/tmp')) / f'carrier-selftest-{os.getpid()}.tar'
    write_archive(buf, good); first = buf.read_bytes(); write_archive(buf, good)
    assert first == buf.read_bytes() and read_archive(buf) == good
    buf.unlink()
    # release record
    sha, tree, repo = 'a' * 40, 'b' * 40, 'roccho-dev/ops'
    prov = {'schema': SCHEMA, 'source': {'repository': repo, 'commit': sha, 'tree': tree},
            'producer': {'repository': repo, 'workflow_ref': f'{repo}/{WORKFLOW}@refs/heads/proposals'},
            'cross_host_bytes_reproducible': False, 'locator': locator(repo, sha),
            'archive': {'name': ARCHIVE, 'bytes': 10, 'sha256': 'c' * 64},
            'official_cache': {'url': OFFICIAL_CACHE, 'public_key': OFFICIAL_KEY}, 'carried': carried,
            'local': {n: 'd.drv' for n in LOCAL} | {NODE['name']: NODE['drv']},
            'external_references': [{'path': NODE['out'], 'signatures': ['cache.nixos.org-1:sig']}]}
    proof = {'pr_number': 1, 'r_exact_head_verdict_ref': 'u', 'merged_at': 't', 'reviewed_head': 'h' * 40,
             'base': 'proposals', 'merge_sha': sha, 'reviewed_tree': tree, 'merge_tree': tree}
    check_release(set(ASSETS), prov, proof, 'c' * 64, 10, sha, repo)
    for bad in (
        lambda p, q, s: s.add('extra.bin'),
        lambda p, q, s: p['source'].__setitem__('commit', 'e' * 40),
        lambda p, q, s: p.__setitem__('cross_host_bytes_reproducible', True),
        lambda p, q, s: p['producer'].__setitem__('workflow_ref', f'{repo}/.github/workflows/other.yml@refs/heads/main'),
        lambda p, q, s: q.__setitem__('merge_tree', 'f' * 40),
        lambda p, q, s: p['external_references'][0].__setitem__('signatures', []),
        lambda p, q, s: p['archive'].__setitem__('sha256', 'd' * 64),
    ):
        p2, q2, s2 = json.loads(json.dumps(prov)), dict(proof), set(ASSETS)
        bad(p2, q2, s2); rejects(check_release, s2, p2, q2, 'c' * 64, 10, sha, repo)
    # Phase B dry run
    log = ('these 7 derivations will be built:\n' + ''.join(f'  /nix/store/{"h" * 32}-{n}.drv\n' for n in sorted(REQUIRED_BUILT))
           + 'these 2 paths will be fetched (1.0 MiB download, 2.0 MiB unpacked):\n  /nix/store/' + 's' * 32 + '-python3\n  /nix/store/'
           + 't' * 32 + '-unzip\n')
    built, fetched = parse_dry_run(log)
    check_dry_run(built, fetched, set(fetched))
    check_dry_run(built + [NODE['drv']], fetched, set(fetched))
    rejects(check_dry_run, built[:-1], fetched, set(fetched))
    rejects(check_dry_run, built + [f'{"h" * 32}-other.drv'], fetched, set(fetched))
    rejects(check_dry_run, built + [f'{"g" * 32}-nodejs-24.14.1.drv'], fetched, set(fetched))
    rejects(check_dry_run, built, fetched + [w], set(fetched) | {w})
    rejects(check_dry_run, built + [f'{"h" * 32}-wrangler-pnpm-deps.drv'], fetched, set(fetched))
    rejects(check_dry_run, built, fetched, set(fetched[:1]))
    print(json.dumps({'selftest': 'PASS', 'negatives_rejected': negatives}))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan'); p.add_argument('--flake', default='.'); p.add_argument('--out', required=True)
    p = sub.add_parser('pack'); p.add_argument('--plan', required=True); p.add_argument('--cache', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('check-pack'); p.add_argument('--plan', required=True); p.add_argument('dir')
    p = sub.add_parser('provenance')
    for k in ('--plan', '--dir', '--root', '--repository', '--sha', '--tree', '--workflow-ref', '--run-id', '--run-attempt', '--out'):
        p.add_argument(k, required=True)
    p = sub.add_parser('verify'); p.add_argument('dir'); p.add_argument('--sha', required=True); p.add_argument('--repository', required=True)
    p = sub.add_parser('dry-run-check'); p.add_argument('--log', required=True)
    sub.add_parser('selftest')
    a = ap.parse_args()
    {'plan': plan, 'pack': pack, 'check-pack': check_pack, 'provenance': provenance, 'verify': verify,
     'dry-run-check': dry_run_check, 'selftest': selftest}[a.cmd](a)


if __name__ == '__main__':
    main()
