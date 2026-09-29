#!/usr/bin/env python3
"""Lint the hayamimi-web release workflow.

Reads the workflow as JSON on stdin (`yq -o=json . <workflow>`) and fails on:
unpinned actions, any Nix or indirect execution in the contents:write job, or
a publish guard that is not exactly the proposals-only manual publish condition.
The write job may only use the pinned checkout and download-artifact actions,
run steps scanned for Nix, and the default or bash shell.
"""
import copy, json, re, sys

PIN = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$')
NIX = re.compile(r'(?<![\w.-])(?:nix|nix-build|nix-shell|nix-store|nix-env|nix-instantiate)(?![\w.-])')
WRITE_USES = {
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
}
SHELLS = {None, 'bash'}
GUARD = {
    "github.event_name == 'workflow_dispatch'",
    'inputs.publish',
    "github.ref == 'refs/heads/proposals'",
    "github.event.repository.default_branch == 'proposals'",
}


def writes(permissions):
    return permissions == 'write-all' or (isinstance(permissions, dict) and permissions.get('contents') == 'write')


def lint(workflow):
    errors = []
    if workflow.get('permissions') != {'contents': 'read'}:
        errors.append('workflow permissions must be exactly contents: read')
    jobs = workflow.get('jobs') or {}
    for name, job in jobs.items():
        for i, step in enumerate(job.get('steps') or []):
            uses = step.get('uses')
            if uses is not None and not PIN.match(uses):
                errors.append(f'{name}[{i}]: action not pinned to a 40-hex commit: {uses}')
    writers = [name for name, job in jobs.items() if writes(job.get('permissions'))]
    if writers != ['publish']:
        errors.append(f'exactly one contents:write job named publish is allowed, found {writers}')
    for name in writers:
        job = jobs[name]
        if job.get('container') or job.get('services'):
            errors.append(f'{name}: contents:write job may not use a container or services')
        for scope, defaults in (('workflow', workflow.get('defaults')), (name, job.get('defaults'))):
            if ((defaults or {}).get('run') or {}).get('shell') not in SHELLS:
                errors.append(f'{scope}: defaults.run.shell must be unset or bash for the contents:write job')
        for i, step in enumerate(job.get('steps') or []):
            if NIX.search(step.get('run') or ''):
                errors.append(f'{name}[{i}]: contents:write job runs Nix')
            if step.get('shell') not in SHELLS:
                errors.append(f'{name}[{i}]: contents:write job step shell must be unset or bash')
            if 'uses' in step and step['uses'] not in WRITE_USES:
                errors.append(f'{name}[{i}]: contents:write job may only use pinned checkout and download-artifact')
        guard = str(job.get('if') or '').strip()
        if set(p.strip() for p in guard.split('&&')) != GUARD or guard.count('&&') != len(GUARD) - 1:
            errors.append(f'{name}: guard must be exactly {" && ".join(sorted(GUARD))}')
        if job.get('needs') != 'build-test' and job.get('needs') != ['build-test']:
            errors.append(f'{name}: must need build-test so it only publishes bytes built in the same run')
    return errors


def selftest():
    pin = 'actions/checkout@' + 'a' * 40
    good = {
        'permissions': {'contents': 'read'},
        'jobs': {
            'build-test': {'steps': [{'uses': pin}, {'run': 'nix build .#hayamimi-web'}]},
            'publish': {
                'needs': 'build-test',
                'if': ' && '.join(sorted(GUARD)),
                'permissions': {'contents': 'write'},
                'steps': [{'uses': sorted(WRITE_USES)[0]}, {'run': 'gh release create "$TAG"', 'shell': 'bash'}],
            },
        },
    }
    assert lint(good) == [], lint(good)
    bad = [
        lambda w: w['jobs']['build-test']['steps'].__setitem__(0, {'uses': 'actions/checkout@v4'}),
        lambda w: w['jobs']['publish']['steps'].append({'run': 'nix flake check'}),
        lambda w: w['jobs']['publish']['steps'].append({'run': 'ls /nix/store'}),
        lambda w: w['jobs']['publish']['steps'].append({'uses': 'cachix/install-nix-action@' + 'b' * 40}),
        lambda w: w['jobs']['publish'].__setitem__('if', "github.event_name == 'workflow_dispatch' && inputs.publish"),
        lambda w: w['jobs']['publish'].__setitem__('if', w['jobs']['publish']['if'] + " || true"),
        lambda w: w['jobs']['publish'].pop('needs'),
        lambda w: w.__setitem__('permissions', 'write-all'),
        lambda w: w['jobs']['build-test'].__setitem__('permissions', {'contents': 'write'}),
        lambda w: w['jobs']['publish']['steps'][1].__setitem__('shell', 'nix shell nixpkgs#bash -c bash {0}'),
        lambda w: w['jobs']['publish'].__setitem__('defaults', {'run': {'shell': 'nix develop -c bash {0}'}}),
        lambda w: w.__setitem__('defaults', {'run': {'shell': 'nix-shell --run {0}'}}),
        lambda w: w['jobs']['publish']['steps'].append({'uses': 'actions/github-script@' + 'c' * 40, 'with': {'script': "require('child_process').execSync('nix build')"}}),
    ]
    for mutate in bad:
        w = copy.deepcopy(good)
        mutate(w)
        assert lint(w), f'lint accepted a bad workflow: {w}'
    return {'positive': 1, 'negative': len(bad)}


def main():
    if sys.argv[1:] == ['--selftest']:
        print(json.dumps(selftest()))
        return
    errors = lint(json.load(sys.stdin))
    if errors:
        raise SystemExit('release workflow lint failed:\n' + '\n'.join(errors))
    print('release workflow lint: PASS')


if __name__ == '__main__':
    main()
