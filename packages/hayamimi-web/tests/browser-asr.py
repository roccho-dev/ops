#!/usr/bin/env python3
import argparse, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('url');ap.add_argument('wav');a=ap.parse_args();wav=str(Path(a.wav).resolve())
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-audio-capture={wav}','--autoplay-policy=no-user-gesture-required']);page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(a.url);page.context.grant_permissions(['microphone'],origin=a.url.rstrip('/'));page.click('#mic');page.wait_for_function("document.querySelector('#box').value.trim().length > 8",timeout=120000);text=page.input_value('#box');page.click('#mic');assert re.search(r'[ぁ-んァ-ン一-龯]',text),text;assert not errors,errors;b.close()
print('browser-asr: PASS')
