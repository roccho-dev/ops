from hashlib import sha256
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / "dist/index.html").read_text(encoding="utf-8")
errors: list[str] = []
console: list[dict[str, str]] = []

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/chromium",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )
    page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: console.append({"type": message.type, "text": message.text}))
    page.set_content(html, wait_until="load", timeout=30_000)
    page.wait_for_function("document.documentElement.dataset.status === 'pass'", timeout=30_000)
    page.screenshot(path=str(root / "dist/preview.png"), full_page=True)
    status = page.locator("html").get_attribute("data-status")
    title = page.title()
    text = page.locator("#surface").inner_text()
    browser.close()

proof = {
    "schema": "ui-jsonl-browser-proof/1",
    "status": "PASS" if status == "pass" and not errors else "FAIL",
    "pass": status == "pass" and not errors,
    "loadMethod": "page.set_content",
    "viewport": {"width": 1600, "height": 900, "deviceScaleFactor": 1},
    "documentStatus": status,
    "title": title,
    "surfaceTextSha256": sha256(text.encode()).hexdigest(),
    "pageErrors": errors,
    "console": console,
    "screenshot": "dist/preview.png",
}
(root / "dist/browser-proof.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n")
if not proof["pass"]:
    raise SystemExit(1)
print(json.dumps(proof, ensure_ascii=False))
