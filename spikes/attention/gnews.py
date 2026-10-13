import json
import sys
import time
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

import feedparser

BILLS = {
    "genius": ('"GENIUS Act" OR "stablecoin bill"', date(2025, 2, 1), date(2025, 8, 15)),
    "hr1": ('"Big Beautiful Bill"', date(2025, 5, 1), date(2025, 8, 1)),
    "ira": ('"Inflation Reduction Act"', date(2022, 7, 25), date(2022, 9, 30)),
}


def window_items(query, start, end):
    q = f"{query} after:{start.isoformat()} before:{end.isoformat()}"
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    feed = feedparser.parse(url, agent="Mozilla/5.0")
    return url, [{
        "title": e.title,
        "source": e.get("source", {}).get("title", ""),
        "source_url": e.get("source", {}).get("href", ""),
        "published": e.get("published", ""),
        "link": e.link,
    } for e in feed.entries]


def collect(key, step_days):
    query, start, end = BILLS[key]
    seen, rows, log = set(), [], []
    day = start
    while day < end:
        nxt = min(day + timedelta(days=step_days), end)
        url, items = window_items(query, day, nxt)
        log.append({"window": [day.isoformat(), nxt.isoformat()], "url": url, "n": len(items)})
        for it in items:
            if it["link"] not in seen:
                seen.add(it["link"])
                rows.append(it | {"query_url": url})
        day = nxt
        time.sleep(1.5)
    return rows, log


if __name__ == "__main__":
    key, step, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])
    rows, log = collect(key, step)
    out.write_text(json.dumps({"bill": key, "windows": log, "items": rows}, indent=1))
    print(key, len(rows), "unique headlines;", "saturated windows:", sum(w["n"] >= 100 for w in log), "/", len(log))
