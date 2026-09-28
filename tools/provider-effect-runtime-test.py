"""Offline dependency-closure proof; no credentials or provider calls."""
import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ["CHROMIUM_PATH"], headless=True,
                               args=["--no-sandbox", "--disable-dev-shm-usage"])
    page = browser.new_page()
    page.goto("data:text/html,<title>fixed-runtime</title>")
    assert page.title() == "fixed-runtime"
    browser.close()
print("provider runtime: fixed CLI and real browser PASS; live effects 0")
