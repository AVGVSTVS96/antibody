"""Fetch article text for a sample of stories.

usage: python -I fetch.py <in.json> <text-dir>
in.json: [{"id", "url", "gnews"?}]; prints one JSON line per article: {"id", "url", "chars", "error"}.
Google News links are decoded to the publisher URL first. Text goes to <text-dir>/<id>.txt.
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import trafilatura
from googlenewsdecoder import gnewsdecoder
from trafilatura.settings import use_config

CONFIG = use_config()
CONFIG.set("DEFAULT", "DOWNLOAD_TIMEOUT", "20")


def fetch(item, out):
    url = item["url"]
    try:
        if item.get("gnews"):
            dec = gnewsdecoder(url, interval=1)
            if not dec.get("success"):
                return {"id": item["id"], "url": None, "chars": 0, "error": "decode"}
            url = dec["decoded_url"]
        html = trafilatura.fetch_url(url, config=CONFIG)
        body = trafilatura.extract(html, config=CONFIG) if html else None
        if body:
            (out / f"{item['id']}.txt").write_text(body)
        return {"id": item["id"], "url": url, "chars": len(body or ""), "error": None if body else "extract"}
    except Exception as e:
        return {"id": item["id"], "url": url, "chars": 0, "error": repr(e)[:200]}


if __name__ == "__main__":
    items = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(8) as pool:
        for r in pool.map(lambda it: fetch(it, out), items):
            print(json.dumps(r), flush=True)
