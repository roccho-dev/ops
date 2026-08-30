#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
from playwright.sync_api import sync_playwright

OPS_PACKAGES = {
    'adrs-obligation-compiler', 'artifact-assembly', 'billing-channel-config',
    'chatgpt-capability', 'chatgpt-reviewer-mode-routing', 'codex-app-browser-chatgpt-ops',
    'cue-append-contract-core', 'dist-runner', 'excalidraw', 'find-packages',
    'functional-core-governance-gate', 'gosh', 'gov-release-proxy',
    'hq-modeling-runtime', 'hq-source-evidence-runtime', 'jsonl-inspect', 'mjs-bundler',
    'model-source-reconcile', 'ops-adr-specs-promotion', 'ops-artifact-materialize',
    'ops-build-defs', 'ops-build-receipt-check', 'ops-capability-loop', 'ops-cdp-core',
    'ops-decision-closure', 'ops-git-write-closure', 'ops-gov-package-output',
    'ops-handoff-core', 'ops-handoff-pack', 'ops-issue-ledger', 'ops-knowledge-intake',
    'ops-package-responses', 'ops-portable-runtime-pack', 'ops-purity',
    'ops-readme-artifact', 'ops-refs-vault', 'ops-runbook-checks',
    'ops-selfcontained-poc', 'ops-specsless-readiness', 'ops-src-runtime-pack',
    'ops-task-runtime', 'ops-thread-fsm', 'package-architecture-map',
    'package-lib-level-governance', 'policy-semantic-compiler', 'prove-feat',
    'shiftleft-admission', 'structured-diagnostic', 'ui-raw-loop-runtime',
}
UI_PACKAGES = {
    'a2ui-adapter-artifacts', 'a2ui-browser', 'artifact-invocation', 'artifact-reference',
    'connectability', 'core-port', 'decision-packet', 'semantic-map-profiles',
    'semantic-map', 'ui-claims', 'ui-projection-evidence', 'ui-receipts', 'url-module',
}
GOV_PACKAGES = {'repo-governance-cli', 'repo-governance'}

OPS_IDS = {f'package:ops:{name}' for name in OPS_PACKAGES}
UI_IDS = {f'package:ui:{name}' for name in UI_PACKAGES}
GOV_IDS = {f'package:governance:{name}' for name in GOV_PACKAGES}
CORE_IDS = {
    'repo:adrs', 'repo:governance', 'repo:policy', 'repo:deploy', 'repo:ui', 'repo:ops',
    'decision:adrs#331', 'decision-pr:adrs#332', 'tool:governance:control-surface-binder',
    'work:governance#210', 'work:ui#181', 'view:semantic-map:map-graph-seq',
    'effect:ops:staging-deploy', 'evidence:ops:byte-readback', 'evidence:ops:browser-readback',
    'gap:accepted-record', 'gap:complete-universe', 'gap:policy-bootstrap',
    'gap:deploy-repo-empty', 'gap:ui-current-bundle', 'gap:terminal-closure',
    'gap:owner-wide-universe', 'gap:package-responsibility', 'gap:package-conformance',
}
REQUIRED_IDS = CORE_IDS | OPS_IDS | UI_IDS | GOV_IDS
REQUIRED_OVERVIEW_TEXT = [
    'ADRS — decisions / authority', 'Governance — deterministic current join',
    'Policy — bootstrap only', 'Deploy — empty repository',
    'UI — Semantic Map renderer', 'Ops — AI factory / package inventory',
    'explicit residuals — never hidden',
]
FOCUS_GROUPS = {
    'adrs': ('repo:adrs', 0.72, {'decision:adrs#331', 'decision-pr:adrs#332', 'gap:accepted-record'}),
    'governance': ('repo:governance', 0.72, GOV_IDS | {'tool:governance:control-surface-binder', 'work:governance#210', 'gap:complete-universe'}),
    'policy-deploy': ('repo:policy', 0.92, {'surface:policy:readme', 'gap:policy-bootstrap'}),
    'ui-packages': ('group:ui:packages', 0.52, UI_IDS),
    'ops-decision-policy': ('group:ops:decision-policy', 0.54, {f'package:ops:{n}' for n in [
        'adrs-obligation-compiler','cue-append-contract-core','functional-core-governance-gate',
        'policy-semantic-compiler','shiftleft-admission','package-lib-level-governance',
        'structured-diagnostic','ops-adr-specs-promotion','ops-purity']}),
    'ops-build-artifact': ('group:ops:build-artifact', 0.54, {f'package:ops:{n}' for n in [
        'artifact-assembly','ops-artifact-materialize','ops-build-defs','ops-build-receipt-check',
        'dist-runner','mjs-bundler','ops-src-runtime-pack','ops-portable-runtime-pack']}),
    'ops-runtime-execution': ('group:ops:runtime-execution', 0.54, {f'package:ops:{n}' for n in [
        'gosh','ops-task-runtime','ops-cdp-core','hq-modeling-runtime','hq-source-evidence-runtime',
        'ui-raw-loop-runtime','ops-thread-fsm','prove-feat']}),
    'ops-carry-handoff': ('group:ops:carry-handoff', 0.54, {f'package:ops:{n}' for n in [
        'chatgpt-capability','chatgpt-reviewer-mode-routing','codex-app-browser-chatgpt-ops',
        'ops-capability-loop','ops-handoff-core','ops-handoff-pack','ops-knowledge-intake','ops-refs-vault']}),
    'ops-closure-receipt': ('group:ops:closure-receipt', 0.54, {f'package:ops:{n}' for n in [
        'ops-decision-closure','ops-git-write-closure','ops-gov-package-output','ops-issue-ledger',
        'ops-package-responses','ops-readme-artifact','ops-runbook-checks','ops-specsless-readiness']}),
    'ops-discovery-delivery': ('group:ops:discovery-delivery', 0.54, {f'package:ops:{n}' for n in [
        'billing-channel-config','excalidraw','find-packages','gov-release-proxy','jsonl-inspect',
        'model-source-reconcile','ops-selfcontained-poc','package-architecture-map']}),
    'ops-delivery-proof': ('group:ops:delivery-proof', 0.42, {
        'effect:ops:staging-deploy','evidence:ops:byte-readback','evidence:ops:browser-readback','gap:terminal-closure'}),
    'global-gaps': ('group:global-gaps', 0.45, {'gap:owner-wide-universe','gap:package-responsibility','gap:package-conformance'}),
}
TEMPORAL_IDS = {
    'decision:adrs#331','decision-pr:adrs#332','gap:accepted-record',
    'package:governance:repo-governance','tool:governance:control-surface-binder','work:governance#210',
    'gap:complete-universe','package:ui:semantic-map-profiles','package:ui:semantic-map','work:ui#181',
    'gap:ui-current-bundle','package:ops:ops-gov-package-output','package:ops:artifact-assembly',
    'package:ops:gov-release-proxy','effect:ops:staging-deploy','evidence:ops:byte-readback',
    'evidence:ops:browser-readback','gap:terminal-closure',
}


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def screenshot_receipt(page, screens: pathlib.Path, name: str) -> dict[str, object]:
    path = screens / f'{name}.png'
    page.screenshot(path=str(path), full_page=False)
    snapshot = page.evaluate('window.semanticMapApp.snapshot()')
    return {
        'name': name,
        'pattern': snapshot['scene']['pattern'],
        'screenshot': path.name,
        'screenshotSha256': digest(path),
        'visibleRegionCount': len(snapshot['scene']['regionIds']),
        'visibleRelationCount': len(snapshot['scene']['relationEndpoints']),
        'zoom': snapshot['camera']['scale'],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('screens', type=pathlib.Path)
    args = parser.parse_args()
    args.screens.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    chrome = os.environ.get('CHROME_BIN')
    console_errors: list[str] = []
    page_errors: list[str] = []
    request_failures: list[str] = []
    captures: list[dict[str, object]] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            executable_path=chrome or None,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
        page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' and 'favicon' not in msg.text.lower() else None)
        page.on('pageerror', lambda exc: page_errors.append(str(exc)))
        page.on('requestfailed', lambda req: request_failures.append(f'{req.url}: {req.failure}'))

        response = page.goto(args.url, wait_until='domcontentloaded', timeout=120_000)
        if response is None or not response.ok:
            raise RuntimeError(f'navigation failed: {response.status if response else "no response"}')
        page.wait_for_function('window.semanticMapSite && window.semanticMapSite.ready === true', timeout=120_000)
        page.wait_for_timeout(1_200)
        if page.locator('#route-state:not([hidden])').count():
            raise RuntimeError(page.locator('#route-state').inner_text())

        runtime = page.evaluate("""() => ({
          ids: window.semanticMapRuntime.records.filter(r => r && (r.type === 'region' || r.type === 'relation')).map(r => r.id),
          regions: window.semanticMapRuntime.records.filter(r => r && r.type === 'region').map(r => ({id:r.id,kind:r.kind,temporal:r.temporal||null})),
          relations: window.semanticMapRuntime.records.filter(r => r && r.type === 'relation').map(r => ({id:r.id,kind:r.kind,from:r.from,to:r.to})),
        })""")
        state_ids = set(runtime['ids'])
        missing_ids = sorted(REQUIRED_IDS - state_ids)
        if missing_ids:
            raise RuntimeError(f'runtime semantic IDs missing: {missing_ids}')
        counts = {
            'opsPackages': sum(item['id'].startswith('package:ops:') for item in runtime['regions']),
            'uiPackages': sum(item['id'].startswith('package:ui:') for item in runtime['regions']),
            'governancePackages': sum(item['id'].startswith('package:governance:') for item in runtime['regions']),
            'regions': len(runtime['regions']),
            'relations': len(runtime['relations']),
            'temporalItems': sum(item['temporal'] is not None for item in runtime['regions']),
            'blockingRelations': sum(item['kind'] == 'blocks' for item in runtime['relations']),
        }
        expected_counts = {'opsPackages': 49, 'uiPackages': 13, 'governancePackages': 2, 'temporalItems': len(TEMPORAL_IDS), 'blockingRelations': 7}
        for key, expected in expected_counts.items():
            if counts[key] != expected:
                raise RuntimeError(f'{key} mismatch: {counts[key]} != {expected}')

        options = page.locator('#pattern-select option').evaluate_all('els => els.map(e => e.value)')
        for required in ['map/1', 'graph/1', 'seq/1']:
            if required not in options:
                raise RuntimeError(f'pattern option missing: {required}')

        page.select_option('#pattern-select', 'map/1')
        page.wait_for_function("window.semanticMapRuntime.view.pattern === 'map/1'", timeout=60_000)
        page.evaluate('window.semanticMapApp.fitOverview()')
        page.wait_for_timeout(900)
        overview_text = page.locator('body').inner_text()
        missing_text = [value for value in REQUIRED_OVERVIEW_TEXT if value not in overview_text]
        if missing_text:
            raise RuntimeError(f'overview labels missing: {missing_text}')
        captures.append(screenshot_receipt(page, args.screens, 'map-overview'))

        focus_results = []
        for name, (target, scale, expected_ids) in FOCUS_GROUPS.items():
            focused = page.evaluate('(value) => window.semanticMapApp.focusRegion(value.target, value.scale)', {'target': target, 'scale': scale})
            if not focused:
                raise RuntimeError(f'cannot focus {target}')
            page.wait_for_timeout(750)
            snapshot = page.evaluate('window.semanticMapApp.snapshot()')
            visible = set(snapshot['scene']['regionIds'])
            missing_visible = sorted(expected_ids - visible)
            if missing_visible:
                raise RuntimeError(f'{name}: expected focused regions not visible: {missing_visible}')
            capture = screenshot_receipt(page, args.screens, f'map-focus-{name}')
            capture['target'] = target
            capture['expectedVisibleCount'] = len(expected_ids)
            captures.append(capture)
            focus_results.append({'name': name, 'target': target, 'visibleExpectedIds': sorted(expected_ids)})

        page.select_option('#pattern-select', 'graph/1')
        page.wait_for_function("window.semanticMapRuntime.view.pattern === 'graph/1'", timeout=60_000)
        page.evaluate('window.semanticMapApp.fitOverview()')
        page.wait_for_timeout(1_000)
        graph_snapshot = page.evaluate('window.semanticMapApp.snapshot()')
        if not graph_snapshot['scene']['regionIds'] or not graph_snapshot['scene']['relationEndpoints']:
            raise RuntimeError('graph/1 rendered no regions or relations')
        captures.append(screenshot_receipt(page, args.screens, 'graph-overview'))

        page.select_option('#pattern-select', 'seq/1')
        page.wait_for_function("window.semanticMapRuntime.view.pattern === 'seq/1'", timeout=60_000)
        page.evaluate("window.semanticMapApp.focusBounds({x:0,y:0,width:2700,height:900})")
        page.wait_for_timeout(1_000)
        seq_snapshot = page.evaluate('window.semanticMapApp.snapshot()')
        seq_visible = set(seq_snapshot['scene']['regionIds'])
        missing_temporal = sorted(TEMPORAL_IDS - seq_visible)
        if missing_temporal:
            raise RuntimeError(f'seq/1 temporal IDs not visible: {missing_temporal}')
        if len(seq_snapshot['scene']['relationEndpoints']) < 13:
            raise RuntimeError(f'seq/1 handoff relations too few: {len(seq_snapshot["scene"]["relationEndpoints"])}')
        captures.append(screenshot_receipt(page, args.screens, 'seq-full-chain'))

        if console_errors:
            raise RuntimeError(f'console errors: {console_errors}')
        if page_errors:
            raise RuntimeError(f'page errors: {page_errors}')
        serious = [value for value in request_failures if not re.search(r'favicon|data:,', value, re.I)]
        if serious:
            raise RuntimeError(f'request failures: {serious}')
        title = page.title()
        browser.close()

    receipt = {
        'schema': 'ops.internalOrganizationMapBrowser/2',
        'status': 'PASS',
        'authority': False,
        'claimCeiling': 'VISUAL_EVALUATION_ONLY',
        'realBrowser': True,
        'browser': 'chromium',
        'url': args.url,
        'title': title,
        'semanticIdCount': len(state_ids),
        'counts': counts,
        'requiredSemanticIds': sorted(REQUIRED_IDS),
        'focusChecks': focus_results,
        'captures': captures,
        'consoleErrors': console_errors,
        'pageErrors': page_errors,
        'requestFailures': request_failures,
    }
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
