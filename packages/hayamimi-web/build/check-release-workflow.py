#!/usr/bin/env python3
"""Lint the hayamimi-web release workflow.

Reads the workflow as JSON on stdin (`yq -o=json . <workflow>`) and fails on:
unpinned actions, any Nix in a contents:write job, or a publish guard that is
not exactly the proposals-only manual publish condition.
"""
import copy, json, re, sys

PIN = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$')
NIX = re.compile(r'(?<![\w.-])(?:nix|nix-build|nix-shell|nix-store|nix-env|nix-instantiate)(?![\w.-])')
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
        for i, step in enumerate(job.get('steps') or []):
            if NIX.search(step.get('run') or ''):
                errors.append(f'{name}[{i}]: contents:write job runs Nix')
            if re.search(r'nix|cachix', step.get('uses') or '', re.I):
                errors.append(f'{name}[{i}]: contents:write job installs Nix')
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
                'steps': [{'uses': pin}, {'run': 'gh release create "$TAG"'}],
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
