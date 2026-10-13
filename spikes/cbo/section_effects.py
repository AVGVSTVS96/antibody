"""Per-section 10-year effect on the deficit (outlays minus revenues), from the flat rows.

usage: python -I section_effects.py <cbo_rows.json> <estimate-name> [top-n]
"""

import collections
import json
import sys

rows = json.load(open(sys.argv[1]))
name, top = sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 10

by = collections.defaultdict(lambda: {"outlays": 0.0, "revenues": 0.0, "cites": set(), "title": None, "bill_sections": {}})
for r in rows:
    if r["estimate"] != name or r["line_kind"] != "section" or r["ten_year_total"] is None:
        continue
    if r["block"] == "direct_spending" and r["measure_kind"] == "outlays" and not r.get("breakdown_of_total"):
        side = "outlays"
    elif r["block"] == "revenues" and r["measure_kind"] == "revenues":
        side = "revenues"
    else:
        continue
    key = " and ".join(r["sections"])
    e = by[key]
    e[side] += r["ten_year_total"]
    e["title"] = r["section_title"]
    e["cites"].add(r["source"]["cite"])
    for b in r["bill_sections"]:
        e["bill_sections"][b["section"]] = b["text_url"]

effects = [{
    "sections": k, "cbo_title": v["title"], "outlays_10yr_musd": round(v["outlays"]), "revenues_10yr_musd": round(v["revenues"]),
    "deficit_10yr_musd": round(v["outlays"] - v["revenues"]), "cbo_sources": sorted(v["cites"]), "bill_text": v["bill_sections"],
} for k, v in by.items()]
effects.sort(key=lambda e: -abs(e["deficit_10yr_musd"]))
json.dump({"estimate": name, "sections_with_dollars": len(effects), "top": effects[:top]}, sys.stdout, indent=1)
