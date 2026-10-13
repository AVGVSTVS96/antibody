import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_FIGHTS = {
    "genius": ["4", "7", "8", "11", "18"],
    "hr1": ["70512", "71119", "70201", "70202", "70120", "72001", "70104", "71115", "70106", "10105"],
    "ira": ["11001", "11201", "11406", "12001", "10101", "10301", "10201", "13401", "13102", "60113"],
}
TOP = 0.85

for bill in sys.argv[1:]:
    rows = {r["section"]: r for r in json.loads((ROOT / f"data/attention/score-{bill}.json").read_text())["all"]}
    hits = [(s, rows[s]["attention_pct"]) for s in PUBLIC_FIGHTS[bill] if s in rows]
    top = sum(p >= TOP for _, p in hits)
    print(f"{bill}: {top}/{len(PUBLIC_FIGHTS[bill])} known public fights in top {1 - TOP:.0%} by attention", hits)
