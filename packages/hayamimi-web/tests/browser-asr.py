#!/usr/bin/env python3
import argparse, json, unicodedata
from pathlib import Path
from playwright.sync_api import sync_playwright

def norm(s):
    s = unicodedata.normalize('NFKC', s)
    return ''.join(c for c in s if not unicodedata.category(c).startswith(('P', 'Z')))

def lev(a, b):
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def golden_reference(path, wav_name):
    data = json.loads(Path(path).read_text())
    for clip in data['clips']:
        if clip['wav'] == wav_name:
            return clip['reference']
    raise SystemExit(f'golden fixture not found: {wav_name}')

ap = argparse.ArgumentParser()
ap.add_argument('url')
ap.add_argument('wav')
ap.add_argument('golden')
a = ap.parse_args()
wav = str(Path(a.wav).resolve())
expected = norm(golden_reference(a.golden, Path(wav).name))

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=[
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        f'--use-file-for-fake-audio-capture={wav}',
        '--autoplay-policy=no-user-gesture-required',
    ])
    page = b.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(a.url)
    page.context.grant_permissions(['microphone'], origin=a.url.rstrip('/'))
    page.click('#mic')
    page.wait_for_function("document.querySelector('#box').value.trim().length > 8", timeout=120000)
    text = page.input_value('#box')
    page.click('#mic')
    actual = norm(text)
    cer = lev(actual, expected) / max(1, len(expected))
    assert cer <= 0.15, f'CER {cer:.4f} > 0.15: {text}'
    assert not errors, errors
    b.close()
print(f'browser-asr: PASS cer={cer:.4f} text={text}')
