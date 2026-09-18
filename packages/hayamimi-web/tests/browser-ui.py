#!/usr/bin/env python3
import argparse
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('url');a=ap.parse_args()
with sync_playwright() as p:
    b=p.chromium.launch(headless=True);page=b.new_page(viewport={'width':360,'height':740});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(a.url);page.wait_for_selector('#box');page.fill('#box','x'*500);page.click('#send');assert page.locator('.message').count()==1;assert page.input_value('#box')=='';assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth');assert page.locator('button').all_text_contents()==['●','↑'];assert not errors,errors;b.close()
print('browser-ui: PASS')
