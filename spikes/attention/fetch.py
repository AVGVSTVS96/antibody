import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import trafilatura
from googlenewsdecoder import gnewsdecoder


def fetch(item):
    try:
        dec = gnewsdecoder(item["link"], interval=1)
        url = dec.get("decoded_url") if dec.get("success") else None
        if not url:
            return item | {"url": None, "text": None, "error": "decode"}
        html = trafilatura.fetch_url(url)
        body = trafilatura.extract(html) if html else None
        return item | {"url": url, "text": body, "error": None if body else "extract"}
    except Exception as e:
        return item | {"url": None, "text": None, "error": repr(e)[:200]}


if __name__ == "__main__":
    src, n, dst = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
    items = json.loads(src.read_text())["items"]
    random.Random(7).shuffle(items)
    with ThreadPoolExecutor(8) as pool:
        rows = list(pool.map(fetch, items[:n]))
    dst.write_text(json.dumps(rows, indent=1))
    ok = sum(bool(r["text"]) for r in rows)
    print(src.name, f"{ok}/{len(rows)} articles with text")
