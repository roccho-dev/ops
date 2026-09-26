#!/usr/bin/env python3
"""Compose three existing Mobile Agent HTML artifacts into one vertical human view."""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import html
import json
from pathlib import Path


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def payload(path: Path) -> str:
    return base64.b64encode(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0)).decode("ascii")


def build(source: Path, map_html: Path, relations_html: Path, history_html: Path, output: Path, title: str) -> dict:
    source_text = source.read_text(encoding="utf-8")
    payloads = {
        "map": payload(map_html),
        "relations": payload(relations_html),
        "history": payload(history_html),
    }
    source_digest = sha256(source.read_bytes())
    payload_json = json.dumps(payloads, sort_keys=True, separators=(",", ":"))
    source_safe = source_text.replace("</script>", "<\\/script>")
    document = f'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>{html.escape(title)}</title><link rel="icon" href="data:,">
<style>:root{{font-family:system-ui,sans-serif;color:#17202a;background:#eef2f6}}*{{box-sizing:border-box}}body{{margin:0}}header.hero{{padding:24px;background:#fff;border-bottom:1px solid #d9e0e7}}main{{max-width:1500px;margin:auto;padding:20px;display:grid;gap:20px}}section{{overflow:hidden;border:1px solid #d7dfe7;border-radius:16px;background:#fff}}section>header{{padding:14px 18px;border-bottom:1px solid #e0e6ec}}h1,h2,p{{margin:.3rem 0}}iframe{{display:block;width:100%;height:min(62vw,680px);min-height:430px;border:0}}.state{{font-size:12px;font-weight:700}}details{{max-width:1500px;margin:0 auto 40px;padding:0 20px}}pre{{max-height:360px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:14px;border-radius:10px}}</style></head>
<body><header class="hero"><h1>{html.escape(title)}</h1><p>同じdecision JSONLから、現在地図・関係・履歴を既存Mobile Agentで縦に比較する非authority候補。</p></header><main>
<section><header><h2>Current Package Map · map/1</h2><span class="state" id="state-map">Loading</span></header><iframe title="Current Package Map" data-frame="map"></iframe></section>
<section><header><h2>Package Relations · graph/1</h2><span class="state" id="state-relations">Loading</span></header><iframe title="Package Relations" data-frame="relations"></iframe></section>
<section><header><h2>Decision History · seq/1</h2><span class="state" id="state-history">Loading</span></header><iframe title="Decision History" data-frame="history"></iframe></section>
</main><details><summary>Source decision JSONL</summary><p>{source_digest}</p><pre id="source-text"></pre></details>
<script id="decision-source" type="application/x-ndjson">{source_safe}</script>
<script id="frame-payloads" type="application/json">{payload_json}</script>
<script>
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function gunzip(s){{const stream=new Blob([bytes(s)]).stream().pipeThrough(new DecompressionStream('gzip'));return new Response(stream).text();}}
const payloads=JSON.parse(document.getElementById('frame-payloads').textContent);
document.getElementById('source-text').textContent=document.getElementById('decision-source').textContent.trim();
for(const [name,data] of Object.entries(payloads)){{const state=document.getElementById('state-'+name);try{{document.querySelector(`[data-frame="${{name}}"]`).srcdoc=await gunzip(data);state.textContent='Ready';}}catch(error){{state.textContent='Error';state.title=String(error);}}}}
</script></body></html>'''
    data = document.encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    return {
        "schema": "ops.packageDecisionAtlasComposite/1", "status": "PASS",
        "authority": False, "one_html": True, "canvases": ["map/1", "graph/1", "seq/1"],
        "source_digest": source_digest, "output": {"path": output.name, "bytes": len(data), "sha256": sha256(data)},
        "boundary": {"new_renderer": False, "new_preset": False, "new_codec": False, "provider_effects": False, "cutover": False},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--map-html", required=True, type=Path)
    parser.add_argument("--relations-html", required=True, type=Path)
    parser.add_argument("--history-html", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--title", default="Package Decision Atlas")
    args = parser.parse_args()
    receipt = build(args.source, args.map_html, args.relations_html, args.history_html, args.output, args.title)
    encoded = json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    if args.receipt:
        args.receipt.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
